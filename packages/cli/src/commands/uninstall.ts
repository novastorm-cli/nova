import { execFile } from 'node:child_process';
import { StructuredLogger } from '@novastorm-ai/core';
import ora from 'ora';

const logger = new StructuredLogger({ isTTY: process.stderr?.isTTY ?? false });
const PKG_NAME = '@novastorm-ai/cli';

function runCommand(cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, output: stderr || error.message });
      } else {
        resolve({ ok: true, output: stdout });
      }
    });
  });
}

export async function uninstallCommand(): Promise<void> {
  const spinner = ora('Uninstalling Novastorm CLI...').start();

  // Try npm first, then pnpm
  let result = await runCommand('npm', ['uninstall', '-g', PKG_NAME]);

  if (!result.ok) {
    result = await runCommand('pnpm', ['uninstall', '-g', PKG_NAME]);
  }

  if (result.ok) {
    spinner.succeed('Novastorm CLI uninstalled.');
    logger.info('\n  Thanks for trying Novastorm.');
    logger.info(`  Feedback? ${'https://github.com/novastorm-cli/nova/issues'}`);
    logger.info(`  Come back anytime: ${`npm install -g ${PKG_NAME}`}\n`);
  } else {
    spinner.fail('Uninstall failed. Try manually:');
    logger.info(`  npm uninstall -g ${PKG_NAME}`);
  }
}
