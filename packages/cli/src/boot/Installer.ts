import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { select, input } from '@inquirer/prompts';
import { isNonInteractive } from './utils.js';
import type { StartOptions } from '../index.js';
import type { StackInfo } from '@novastorm-ai/core';

const SELECT_THEME = {
  icon: { cursor: chalk.whiteBright('❯') },
  style: {
    highlight: (text: string) => chalk.whiteBright(text.replace(/\x1b\[\d+m/g, '')),
  },
  indexMode: 'hidden' as const,
};

const NODE_FRAMEWORKS = [
  'node',
  'express',
  'nest',
  'fastify',
  'koa',
  'hapi',
  'next.js',
  'nuxt',
  'sveltekit',
  'astro',
  'vite',
  'cra',
];

/**
 * Ensure `node_modules` is installed for Node.js projects.
 *
 * If the directory is missing, runs the appropriate package manager
 * (`npm` / `pnpm` / `yarn`) and surfaces interactive recovery flows
 * on failure.  In non-interactive mode, skips install recovery and
 * continues without installing.
 *
 * @param llmClient - optional LLM client for AI-assisted recovery.
 */
export async function ensureDependencies(
  cwd: string,
  stack: StackInfo,
  options: StartOptions,
  llmClient: unknown | null,
): Promise<void> {
  if (!NODE_FRAMEWORKS.includes(stack.framework)) return;
  if (existsSync(join(cwd, 'node_modules'))) return;

  const pm = stack.packageManager ?? 'npm';
  const installCmd = pm === 'yarn' ? 'yarn' : `${pm} install`;

  const spinner = ora();
  spinner.stop();
  console.log(chalk.dim(`  Installing dependencies (${installCmd})...`));

  try {
    const { execSync } = await import('node:child_process');
    execSync(installCmd, { cwd, stdio: 'pipe' });
    console.log(chalk.green('  Dependencies installed.'));
    return;
  } catch (installErr) {
    const stderr = (installErr as { stderr?: Buffer })?.stderr?.toString() ?? '';
    const errMsg =
      stderr || (installErr instanceof Error ? installErr.message : String(installErr));
    const errorLines = errMsg
      .split('\n')
      .filter((l) => /error/i.test(l))
      .slice(0, 5);
    console.log(chalk.red(`\n  Failed to install dependencies.`));
    if (errorLines.length) {
      console.log(chalk.dim(errorLines.map((l) => `  ${l.trim()}`).join('\n')));
    }
    console.log();
  }

  // ── Install failed — handle recovery ────────────────────────────────
  if (isNonInteractive(options)) {
    console.log(
      chalk.dim('Non-interactive mode — skipping install recovery. Run "npm install" manually.'),
    );
    return;
  }

  // Re-fetch error for recovery UI
  let errMsg: string;
  try {
    const { execSync } = await import('node:child_process');
    execSync(installCmd, { cwd, stdio: 'pipe' });
    return; // it worked this time
  } catch (installErr) {
    const stderr = (installErr as { stderr?: Buffer })?.stderr?.toString() ?? '';
    errMsg = stderr || (installErr instanceof Error ? installErr.message : String(installErr));
  }

  const choices: Array<{ name: string; value: string }> = [];

  if (/EJSONPARSE|JSON/.test(errMsg)) {
    console.log(chalk.yellow('  Cause: package.json contains invalid JSON.\n'));
    choices.push({
      name: chalk.dim('Fix package.json automatically (remove syntax errors)'),
      value: 'fix-json',
    });
  }
  if (/ENOENT|not found|Cannot find/.test(errMsg)) {
    console.log(chalk.yellow('  Cause: missing files or modules.\n'));
  }

  if (llmClient) {
    choices.push({
      name: chalk.dim('Describe what to fix (AI will handle it)'),
      value: 'ai-fix',
    });
  }
  choices.push(
    { name: chalk.dim('Skip install and continue'), value: 'skip' },
    { name: chalk.dim('Exit'), value: 'exit' },
  );

  let resolved = false;
  while (!resolved) {
    let action: string;
    try {
      action = await select({
        message: 'What would you like to do?',
        choices,
        theme: SELECT_THEME,
      });
    } catch {
      process.exit(0);
    }

    if (action === 'fix-json') {
      resolved = await handleFixJson(cwd, installCmd, errMsg, llmClient);
    } else if (action === 'ai-fix') {
      resolved = await handleAiFix(cwd, installCmd, errMsg, llmClient);
    } else if (action === 'skip') {
      console.log(chalk.dim('  Skipping install.'));
      resolved = true;
    } else {
      process.exit(0);
    }
  }
}

// ── Recovery helpers ─────────────────────────────────────────────────────

async function handleFixJson(
  cwd: string,
  installCmd: string,
  errMsg: string,
  llmClient: unknown | null,
): Promise<boolean> {
  try {
    const pkgPath = join(cwd, 'package.json');
    let content = readFileSync(pkgPath, 'utf-8');

    // Step 1: regex fixes
    content = content.replace(/,(\s*[}\]])/g, '$1');
    content = content.replace(/"(\s*\n\s*")/g, '",\n  "');
    writeFileSync(pkgPath, content, 'utf-8');

    // Step 2: validate — if still broken, use AI
    try {
      JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      if (llmClient) {
        console.log(chalk.dim('  Regex fix insufficient, asking AI to fix package.json...\n'));
        const brokenContent = readFileSync(pkgPath, 'utf-8');
        const response = await (
          llmClient as { chat: (msgs: unknown[], opts: unknown) => Promise<{ content: string }> }
        ).chat(
          [
            {
              role: 'system',
              content:
                'You are a JSON fixer. You receive a broken package.json. Output ONLY the corrected valid JSON. No explanation, no markdown fences, just the JSON.',
            },
            { role: 'user', content: `Fix this package.json:\n\n${brokenContent}` },
          ],
          { temperature: 0, maxTokens: 4096 },
        );

        let fixed = response.content.trim();
        const fenceMatch = fixed.match(/```(?:json)?\n([\s\S]*?)```/);
        if (fenceMatch) fixed = fenceMatch[1].trim();
        JSON.parse(fixed);
        writeFileSync(pkgPath, fixed, 'utf-8');
        console.log(chalk.green('  AI fixed package.json.'));
      }
    }

    console.log(chalk.dim('  Retrying install...\n'));
    const { execSync } = await import('node:child_process');
    execSync(installCmd, { cwd, stdio: 'pipe' });
    console.log(chalk.green('  Dependencies installed.'));
    return true;
  } catch (fixErr) {
    console.log(chalk.red(`  Fix failed: ${fixErr instanceof Error ? fixErr.message : fixErr}\n`));
    return false;
  }
}

async function handleAiFix(
  cwd: string,
  installCmd: string,
  errMsg: string,
  llmClient: unknown | null,
): Promise<boolean> {
  try {
    const userDesc = await input({ message: 'Describe what needs to be fixed:' });
    if (!userDesc.trim() || !llmClient) return false;

    console.log(chalk.dim('\n  AI is working on it...\n'));
    const response = await (
      llmClient as { chat: (msgs: unknown[], opts: unknown) => Promise<{ content: string }> }
    ).chat(
      [
        {
          role: 'system',
          content: `You are a code fixer. You receive an error and a user description of what to fix. Output ONLY the fixed file content with no explanation. Format:\n=== FILE: path/to/file ===\nfull file content\n=== END FILE ===`,
        },
        {
          role: 'user',
          content: `Error:\n${errMsg.slice(0, 800)}\n\nUser says: ${userDesc.trim()}\n\nProject directory: ${cwd}\nFix the issue. Output the corrected file(s).`,
        },
      ],
      { temperature: 0, maxTokens: 4096 },
    );

    const fileBlockRegex = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g;
    let match: RegExpExecArray | null;
    let filesWritten = 0;
    while ((match = fileBlockRegex.exec(response.content)) !== null) {
      const filePath = join(cwd, match[1].trim());
      const fileContent = match[2];
      const { mkdirSync, writeFileSync: writeSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(filePath), { recursive: true });
      writeSync(filePath, fileContent, 'utf-8');
      console.log(chalk.dim(`  Wrote: ${match[1].trim()}`));
      filesWritten++;
    }

    if (filesWritten > 0) {
      console.log(chalk.green(`\n  AI fixed ${filesWritten} file(s). Retrying install...\n`));
      const { execSync } = await import('node:child_process');
      execSync(installCmd, { cwd, stdio: 'pipe' });
      console.log(chalk.green('  Dependencies installed.'));
      return true;
    }

    console.log(chalk.red('  AI could not produce a fix.\n'));
    return false;
  } catch (aiErr) {
    console.log(chalk.red(`  Failed: ${aiErr instanceof Error ? aiErr.message : aiErr}\n`));
    return false;
  }
}
