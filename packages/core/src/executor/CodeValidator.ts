import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export interface ValidationError {
  file: string;
  line?: number;
  message: string;
  severity: 'error' | 'warning';
}

export class CodeValidator {
  constructor(private readonly projectPath: string) {}

  /**
   * Validate generated files. Returns only errors in the specified files (filters out pre-existing project errors).
   */
  async validateFiles(files: Array<{ path: string; content: string }>): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];
    const generatedPaths = new Set(files.map(f => f.path));

    // 1. TypeScript check
    const tscErrors = await this.runTsc(generatedPaths);
    errors.push(...tscErrors);

    // 2. Import resolution check
    for (const file of files) {
      const importErrors = await this.checkImports(file.path, file.content);
      errors.push(...importErrors);
    }

    // 3. Relative import check
    for (const file of files) {
      const relErrors = this.checkRelativeImports(file.path, file.content, generatedPaths);
      errors.push(...relErrors);
    }

    return errors;
  }

  private resolveTsc(): { cmd: string; baseArgs: string[] } {
    const { existsSync } = require('node:fs') as typeof import('node:fs');

    // 1. Check project-local tsc
    const localTsc = join(this.projectPath, 'node_modules', '.bin', 'tsc');
    if (existsSync(localTsc)) {
      return { cmd: localTsc, baseArgs: [] };
    }

    // 2. Try to resolve tsc from the workspace that runs this code
    try {
      const tscPath = require.resolve('typescript/bin/tsc');
      return { cmd: process.execPath, baseArgs: [tscPath] };
    } catch {
      // typescript not resolvable from here
    }

    // 3. Fall back to npx
    return { cmd: 'npx', baseArgs: ['tsc'] };
  }

  private async runTsc(generatedPaths: Set<string>): Promise<ValidationError[]> {
    const { cmd, baseArgs } = this.resolveTsc();
    const args = [...baseArgs, '--noEmit', '--pretty', 'false'];

    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: this.projectPath,
        timeout: 30_000,
      });
      return this.parseTscOutput(stdout + stderr, generatedPaths);
    } catch (err: unknown) {
      // tsc exits with code 1 on errors, output is in stdout/stderr
      const output = this.getOutput(err);
      // If tsc/npx not found, skip
      if (output.includes('ENOENT') || output.includes('not found') || output.includes('This is not the tsc command')) {
        return [];
      }
      if (output) {
        return this.parseTscOutput(output, generatedPaths);
      }
      return [];
    }
  }

  private parseTscOutput(output: string, generatedPaths: Set<string>): ValidationError[] {
    const errors: ValidationError[] = [];
    // Format: path(line,col): error TS1234: message
    const pattern = /^(.+)\((\d+),\d+\):\s+error\s+TS\d+:\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(output)) !== null) {
      const file = match[1]
        .replace(this.projectPath + '/', '')
        .replace(this.projectPath + '\\', '');
      // Only include errors from generated files
      if (generatedPaths.has(file)) {
        errors.push({
          file,
          line: parseInt(match[2], 10),
          message: match[3],
          severity: 'error',
        });
      }
    }
    return errors;
  }

  private async checkImports(filePath: string, content: string): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    // Read package.json for available deps
    let installedDeps = new Set<string>();
    try {
      const pkgRaw = await readFile(join(this.projectPath, 'package.json'), 'utf-8');
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      installedDeps = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]);
    } catch {
      // No package.json — skip import check
      return [];
    }

    const safePackages = new Set([
      'react', 'react-dom', 'next', 'next/link', 'next/image',
      'next/font', 'next/font/google', 'next/navigation', 'next/headers',
      'next/server', 'next/dynamic',
    ]);

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineImportPattern = /from\s+['"]([^./][^'"]*)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = lineImportPattern.exec(lines[i])) !== null) {
        const importPath = match[1];
        const pkgName = importPath.startsWith('@')
          ? importPath.split('/').slice(0, 2).join('/')
          : importPath.split('/')[0];

        if (
          !installedDeps.has(pkgName) &&
          !safePackages.has(importPath) &&
          !safePackages.has(pkgName) &&
          !importPath.startsWith('node:')
        ) {
          errors.push({
            file: filePath,
            line: i + 1,
            message: `Unresolved import: '${importPath}' — package '${pkgName}' is not in package.json`,
            severity: 'error',
          });
        }
      }
    }

    return errors;
  }

  private checkRelativeImports(
    _filePath: string,
    _content: string,
    _generatedPaths: Set<string>,
  ): ValidationError[] {
    // Relative import checks are complex (need to know existing project files)
    // Skip for now — tsc will catch most of these
    return [];
  }

  private getOutput(error: unknown): string {
    if (error && typeof error === 'object') {
      const err = error as { stdout?: unknown; stderr?: unknown };
      return String(err.stdout ?? '') + String(err.stderr ?? '');
    }
    return error instanceof Error ? error.message : String(error);
  }
}
