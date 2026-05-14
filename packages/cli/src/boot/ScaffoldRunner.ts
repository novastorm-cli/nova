import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { input } from '@inquirer/prompts';
import TOML from '@iarna/toml';
import { StackDetector } from '@novastorm-ai/core';
import type { NovaConfig } from '@novastorm-ai/core';
import { promptAndScaffold } from '../scaffold.js';
import { isNonInteractive } from './utils.js';
import type { StartOptions } from '../index.js';

export interface ScaffoldResult {
  /** The resolved dev command (possibly after scaffolding + re-detection). */
  devCommand: string;
  /** The resolved dev port. */
  devPort: number;
}

/**
 * Scaffold runner — wraps {@link promptAndScaffold} and re-detects the
 * project stack after scaffolding completes.
 *
 * When `devCommand` is already known this function is a no-op.
 */
export async function runScaffold(
  cwd: string,
  config: NovaConfig,
  options: StartOptions,
  devCommand: string | undefined,
  devPort: number | undefined,
): Promise<ScaffoldResult | null> {
  if (devCommand) return null; // already resolved — nothing to do

  // Check if directory already has project files
  const projectMarkers = [
    'package.json',
    'requirements.txt',
    'go.mod',
    'Cargo.toml',
    'pom.xml',
    'build.gradle',
    'composer.json',
    'Gemfile',
  ];
  const hasProjectFiles =
    projectMarkers.some((f) => existsSync(join(cwd, f))) ||
    readdirSync(cwd).some((f) => f.endsWith('.sln') || f.endsWith('.csproj'));

  const stackDetector = new StackDetector();
  const stack = await stackDetector.detectStack(cwd);

  if (hasProjectFiles) {
    // Existing project but dev command unknown — derive a default
    const defaultCmd =
      stack.framework === 'dotnet'
        ? 'dotnet run'
        : stack.framework === 'django'
          ? 'python manage.py runserver'
          : stack.framework === 'fastapi'
            ? 'uvicorn main:app --reload'
            : stack.framework === 'flask'
              ? 'flask run'
              : stack.framework === 'rails'
                ? 'bin/rails server'
                : stack.framework === 'laravel'
                  ? 'php artisan serve'
                  : stack.framework === 'spring-boot'
                    ? './mvnw spring-boot:run'
                    : existsSync(join(cwd, 'package.json'))
                      ? 'npm run dev'
                      : '';

    if (isNonInteractive(options)) {
      if (defaultCmd) {
        return {
          devCommand: defaultCmd,
          devPort: devPort ?? (await stackDetector.detectPort(stack, cwd)),
        };
      }
      console.error(
        chalk.red('Dev command is required. Add [project] devCommand = "..." to nova.toml'),
      );
      process.exit(1);
    }

    const stackLabel =
      stack.framework !== 'unknown' ? ` (${chalk.cyan(stack.framework)} detected)` : '';

    let devCmd: string;
    try {
      devCmd = await input({
        message: `Dev command not found${stackLabel}. Enter your dev command:`,
        default: defaultCmd || undefined,
      });
    } catch {
      console.log('\nCancelled.');
      process.exit(0);
    }

    if (devCmd && devCmd.trim()) {
      const resolved = devCmd.trim();
      // Save to nova.toml for future runs
      try {
        const novaTomlPath = join(cwd, 'nova.toml');
        let tomlContent: Record<string, unknown> = {};
        if (existsSync(novaTomlPath)) {
          tomlContent = TOML.parse(readFileSync(novaTomlPath, 'utf-8'));
        }
        const project = (tomlContent['project'] as Record<string, unknown>) ?? {};
        project['devCommand'] = resolved;
        tomlContent['project'] = project;
        writeFileSync(novaTomlPath, TOML.stringify(tomlContent as TOML.JsonMap), 'utf-8');
        console.log(chalk.dim(`Saved devCommand to nova.toml`));
      } catch {
        // Non-critical — continue without saving
      }
      return {
        devCommand: resolved,
        devPort: devPort ?? (await stackDetector.detectPort(stack, cwd)),
      };
    }

    console.error(
      chalk.red('Dev command is required. Add [project] devCommand = "..." to nova.toml'),
    );
    process.exit(1);
  }

  // ── Empty directory — scaffold ──────────────────────────────────
  const spinner = ora();
  const scaffoldInfo = await promptAndScaffold(cwd);

  if (!scaffoldInfo.scaffolded) {
    // User chose 'empty' — nothing more to do
    process.exit(0);
  }

  // Apply frontend/backends from scaffold to config (for multi-stack projects)
  if (scaffoldInfo.frontend) config.project.frontend = scaffoldInfo.frontend;
  if (scaffoldInfo.backends) config.project.backends = scaffoldInfo.backends;

  // Re-detect stack after scaffolding
  spinner.start('Re-detecting project...');
  const newStack = await stackDetector.detectStack(cwd);
  const detectedDevCommand = await stackDetector.detectDevCommand(newStack, cwd);
  const detectedPort = await stackDetector.detectPort(newStack, cwd);
  const reStacks =
    [newStack.framework, ...(newStack.additionalStacks ?? [])]
      .filter((s) => s !== 'unknown')
      .join(' + ') || 'unknown';
  spinner.succeed(
    `Detecting project... ${chalk.cyan(reStacks)} (${chalk.dim(newStack.typescript ? 'TypeScript' : newStack.language || 'unknown')})`,
  );

  const resolvedCommand = config.project.devCommand || detectedDevCommand;
  const resolvedPort = config.project.port || detectedPort;

  if (!resolvedCommand) {
    console.error(
      chalk.red(
        'No dev command found after scaffolding. Set project.devCommand in nova.toml or ensure package.json has a "dev" script.',
      ),
    );
    process.exit(1);
  }

  return { devCommand: resolvedCommand, devPort: resolvedPort };
}
