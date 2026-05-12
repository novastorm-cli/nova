import { resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import picomatch from 'picomatch';
import type { IPathGuard } from '../contracts/IPathGuard.js';
import { PathDeniedError, PathTraversalError } from '../contracts/IPathGuard.js';

export class PathGuard implements IPathGuard {
  private readonly projectRoot: string;
  private readonly allowed = new Set<string>();
  private readonly denied = new Set<string>();
  private readonly promptFn: (dir: string) => Promise<boolean>;
  private readonlyMatcher: ((path: string) => boolean) | null = null;
  private ignoredMatcher: ((path: string) => boolean) | null = null;
  private writableMatchers: ((path: string) => boolean)[] = [];

  constructor(projectPath: string, promptFn?: (dir: string) => Promise<boolean>) {
    this.projectRoot = resolve(projectPath);
    this.promptFn = promptFn ?? this.defaultPrompt.bind(this);

    // Auto-allow project root and .nova
    this.allowed.add(this.projectRoot);
    this.allowed.add(resolve(this.projectRoot, '.nova'));
  }

  allow(dirPath: string): void {
    this.allowed.add(resolve(dirPath));
  }

  validate(absPath: string): void {
    const resolved = resolve(absPath);
    if (!resolved.startsWith(this.projectRoot + sep) && resolved !== this.projectRoot) {
      throw new PathTraversalError(
        `Path "${absPath}" is outside project root "${this.projectRoot}"`,
      );
    }
  }

  loadBoundaries(boundaries: {
    writable?: string[];
    readonly?: string[];
    ignored?: string[];
  }): void {
    if (boundaries.writable) {
      this.writableMatchers = boundaries.writable.map((p) => picomatch(p, { dot: false }));
    }
    if (boundaries.readonly && boundaries.readonly.length > 0) {
      this.readonlyMatcher = picomatch(boundaries.readonly);
    }
    if (boundaries.ignored && boundaries.ignored.length > 0) {
      this.ignoredMatcher = picomatch(boundaries.ignored);
    }
  }

  isReadonly(absPath: string): boolean {
    if (!this.readonlyMatcher) return false;
    const rel = this.toProjectRelative(absPath);
    return this.readonlyMatcher(rel);
  }

  isIgnored(absPath: string): boolean {
    if (!this.ignoredMatcher) return false;
    const rel = this.toProjectRelative(absPath);
    return this.ignoredMatcher(rel);
  }

  private toProjectRelative(absPath: string): string {
    const resolved = resolve(absPath);
    if (resolved.startsWith(this.projectRoot + sep)) {
      return resolved
        .slice(this.projectRoot.length + 1)
        .split(sep)
        .join('/');
    }
    return resolved;
  }

  async check(absPath: string): Promise<void> {
    this.validate(absPath);

    // 1. Ignored patterns take highest precedence
    if (this.isIgnored(absPath)) {
      throw new PathDeniedError(`Access denied (ignored): "${absPath}"`);
    }

    // 2. Readonly patterns take precedence over writable
    if (this.isReadonly(absPath)) {
      throw new PathDeniedError(`Access denied (readonly): "${absPath}"`);
    }

    // 3. Convert to project-relative path for picomatch-based writable matching
    const relPath = this.toProjectRelative(absPath);

    // 4. Check writable patterns (picomatch-based, no pattern collapsing)
    if (this.writableMatchers.length > 0) {
      if (this.writableMatchers.some((m) => m(relPath))) {
        return;
      }

      // Allow .nova/ system directory even when writable boundaries are set
      const resolved = resolve(absPath);
      const novaDir = resolve(this.projectRoot, '.nova');
      if (resolved.startsWith(novaDir + sep) || resolved === novaDir) {
        return;
      }

      // File doesn't match any writable pattern → deny
      throw new PathDeniedError(`Access denied (not in writable boundaries): "${absPath}"`);
    }

    // 5. No writable patterns configured → fall back to directory-based allow/deny/prompt logic
    const dirPath = resolve(absPath, '..');

    if (this.isAllowed(dirPath)) {
      return;
    }

    if (this.isDenied(dirPath)) {
      throw new PathDeniedError(`Access denied: "${absPath}"`);
    }

    // Unknown directory — prompt user
    const granted = await this.promptFn(dirPath);
    if (granted) {
      this.allowed.add(dirPath);
    } else {
      this.denied.add(dirPath);
      throw new PathDeniedError(`Access denied by user: "${absPath}"`);
    }
  }

  private isAllowed(dirPath: string): boolean {
    // Direct match
    if (this.allowed.has(dirPath)) return true;
    // Check if dirPath is a child of any allowed path (including project root)
    for (const allowed of this.allowed) {
      if (dirPath.startsWith(allowed + sep) || dirPath === allowed) {
        return true;
      }
    }
    return false;
  }

  private isDenied(dirPath: string): boolean {
    if (this.denied.has(dirPath)) return true;
    for (const denied of this.denied) {
      if (dirPath.startsWith(denied + sep)) return true;
    }
    return false;
  }

  private async defaultPrompt(dir: string): Promise<boolean> {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = await rl.question(`[PathGuard] Allow writing to "${dir}"? (y/N) `);
      return answer.trim().toLowerCase() === 'y';
    } finally {
      rl.close();
    }
  }
}
