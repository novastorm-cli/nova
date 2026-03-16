import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IValidator } from '../contracts/IExecutor.js';
import type { ValidationResult } from '../models/types.js';

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 30_000;

export class Validator implements IValidator {
  async validate(projectPath: string, changedFiles: string[]): Promise<ValidationResult> {
    const errors: ValidationResult['errors'] = [];

    // 1. TypeScript check
    if (existsSync(join(projectPath, 'tsconfig.json'))) {
      const tscErrors = await this.runTsc(projectPath);
      errors.push(...tscErrors);
    }

    // 2. ESLint check
    if (this.hasEslintConfig(projectPath) && changedFiles.length > 0) {
      const eslintErrors = await this.runEslint(projectPath, changedFiles);
      errors.push(...eslintErrors);
    }

    // 3. Build check
    const buildErrors = await this.runBuild(projectPath);
    errors.push(...buildErrors);

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private async runTsc(
    projectPath: string,
  ): Promise<ValidationResult['errors']> {
    // Try local node_modules/.bin/tsc first, then npx
    const localTsc = join(projectPath, 'node_modules', '.bin', 'tsc');
    const useLocalTsc = existsSync(localTsc);

    const cmd = useLocalTsc ? localTsc : 'tsc';
    const args = useLocalTsc ? ['--noEmit'] : ['--noEmit'];

    try {
      await execFileAsync(cmd, args, {
        cwd: projectPath,
        timeout: TIMEOUT_MS,
      });
      return [];
    } catch (error: unknown) {
      // If tsc binary is not found at all, skip the check
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ENOENT') || message.includes('not found')) {
        return [];
      }
      return this.parseTscOutput(this.getStdout(error));
    }
  }

  private parseTscOutput(output: string): ValidationResult['errors'] {
    const errors: ValidationResult['errors'] = [];
    const linePattern = /^(.+)\((\d+),\d+\):\s+error\s+TS\d+:\s+(.+)$/gm;

    let match: RegExpExecArray | null;
    while ((match = linePattern.exec(output)) !== null) {
      errors.push({
        file: match[1],
        line: parseInt(match[2], 10),
        message: match[3],
      });
    }

    // Fallback: if no structured matches but there is output, report raw
    if (errors.length === 0 && output.trim()) {
      errors.push({
        file: 'tsconfig.json',
        message: `TypeScript compilation failed: ${output.trim().substring(0, 500)}`,
      });
    }

    return errors;
  }

  private hasEslintConfig(projectPath: string): boolean {
    const configNames = [
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      '.eslintrc.yml',
      '.eslintrc.yaml',
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
      'eslint.config.ts',
    ];
    return configNames.some((name) => existsSync(join(projectPath, name)));
  }

  private async runEslint(
    projectPath: string,
    files: string[],
  ): Promise<ValidationResult['errors']> {
    try {
      await execFileAsync('npx', ['eslint', '--format', 'json', ...files], {
        cwd: projectPath,
        timeout: TIMEOUT_MS,
      });
      return [];
    } catch (error: unknown) {
      return this.parseEslintOutput(this.getStdout(error));
    }
  }

  private parseEslintOutput(output: string): ValidationResult['errors'] {
    const errors: ValidationResult['errors'] = [];

    try {
      const results = JSON.parse(output) as Array<{
        filePath: string;
        messages: Array<{
          line: number;
          message: string;
          severity: number;
        }>;
      }>;

      for (const result of results) {
        for (const msg of result.messages) {
          if (msg.severity >= 2) {
            errors.push({
              file: result.filePath,
              line: msg.line,
              message: msg.message,
            });
          }
        }
      }
    } catch {
      if (output.trim()) {
        errors.push({
          file: 'eslint',
          message: `ESLint failed: ${output.trim().substring(0, 500)}`,
        });
      }
    }

    return errors;
  }

  private async runBuild(
    projectPath: string,
  ): Promise<ValidationResult['errors']> {
    const pkgPath = join(projectPath, 'package.json');
    if (!existsSync(pkgPath)) return [];

    try {
      const { readFile } = await import('node:fs/promises');
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as {
        scripts?: Record<string, string>;
      };

      if (!pkg.scripts?.['build']) return [];

      await execFileAsync('npm', ['run', 'build'], {
        cwd: projectPath,
        timeout: TIMEOUT_MS,
      });
      return [];
    } catch (error: unknown) {
      const stderr = this.getStderr(error);
      return [
        {
          file: 'package.json',
          message: `Build failed: ${stderr.trim().substring(0, 500)}`,
        },
      ];
    }
  }

  private getStdout(error: unknown): string {
    if (error && typeof error === 'object' && 'stdout' in error) {
      return String((error as { stdout: unknown }).stdout);
    }
    return error instanceof Error ? error.message : String(error);
  }

  private getStderr(error: unknown): string {
    if (error && typeof error === 'object' && 'stderr' in error) {
      return String((error as { stderr: unknown }).stderr);
    }
    return this.getStdout(error);
  }
}
