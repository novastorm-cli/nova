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
  private readonlyPatterns: string[] = [];
  private ignoredPatterns: string[] = [];

  constructor(
    projectPath: string,
    promptFn?: (dir: string) => Promise<boolean>,
  ) {
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

  loadBoundaries(boundaries: { writable?: string[]; readonly?: string[]; ignored?: string[] }): void {
    if (boundaries.writable) {
      for (const pattern of boundaries.writable) {
        this.allowed.add(resolve(this.projectRoot, pattern.replace(/\*\*.*/, '')));
      }
    }
    if (boundaries.readonly) {
      this.readonlyPatterns = boundaries.readonly;
    }
    if (boundaries.ignored) {
      this.ignoredPatterns = boundaries.ignored;
    }
  }

  isReadonly(absPath: string): boolean {
    if (this.readonlyPatterns.length === 0) return false;
    const rel = this.toProjectRelative(absPath);
    const matcher = picomatch(this.readonlyPatterns);
    return matcher(rel);
  }

  isIgnored(absPath: string): boolean {
    if (this.ignoredPatterns.length === 0) return false;
    const rel = this.toProjectRelative(absPath);
    const matcher = picomatch(this.ignoredPatterns);
    return matcher(rel);
  }

  private toProjectRelative(absPath: string): string {
    const resolved = resolve(absPath);
    if (resolved.startsWith(this.projectRoot + sep)) {
      return resolved.slice(this.projectRoot.length + 1).split(sep).join('/');
    }
    return resolved;
  }

  async check(absPath: string): Promise<void> {
    this.validate(absPath);

    if (this.isIgnored(absPath)) {
      throw new PathDeniedError(`Access denied (ignored): "${absPath}"`);
    }
    if (this.isReadonly(absPath)) {
      throw new PathDeniedError(`Access denied (readonly): "${absPath}"`);
    }

    const dirPath = resolve(absPath, '..');

    // Check if the file's directory is directly allowed or is a child of an allowed directory
    if (this.isAllowed(dirPath)) {
      return;
    }

    // Check if the directory is denied
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
      const answer = await rl.question(
        `[PathGuard] Allow writing to "${dir}"? (y/N) `,
      );
      return answer.trim().toLowerCase() === 'y';
    } finally {
      rl.close();
    }
  }
}
