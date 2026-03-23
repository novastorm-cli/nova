import { execFile } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';

const PKG_NAME = '@novastorm-ai/cli';

function isNewer(remote: string, local: string): boolean {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}

async function getLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { version: string };
        return data.version;
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

function runNpmInstall(): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile('npm', ['install', '-g', `${PKG_NAME}@latest`], { timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, output: stderr || error.message });
      } else {
        resolve({ ok: true, output: stdout });
      }
    });
  });
}

export async function updateCommand(): Promise<void> {
  const spinner = ora('Checking for updates...').start();

  const latest = await getLatestVersion();
  if (!latest) {
    spinner.fail('Could not reach npm registry. Check your internet connection.');
    return;
  }

  const { readFileSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let currentVersion = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')) as { version: string };
    currentVersion = pkg.version;
  } catch { /* ignore */ }

  if (!isNewer(latest, currentVersion)) {
    spinner.succeed(`Already on the latest version ${chalk.green(currentVersion)}`);
    return;
  }

  spinner.text = `Updating ${chalk.gray(currentVersion)} → ${chalk.green(latest)}...`;

  const result = await runNpmInstall();

  if (result.ok) {
    spinner.succeed(`Updated to ${chalk.green(latest)}`);
  } else {
    spinner.fail('Update failed. Try manually:');
    console.log(chalk.cyan(`  npm install -g ${PKG_NAME}@latest`));
    if (result.output) {
      console.log(chalk.gray(result.output.trim()));
    }
  }
}

let updateBannerInterval: ReturnType<typeof setInterval> | null = null;

export async function checkForUpdates(currentVersion: string): Promise<void> {
  try {
    const latest = await getLatestVersion();
    if (!latest || !isNewer(latest, currentVersion)) return;

    const msg = chalk.bgYellow.black(` UPDATE `) +
      chalk.yellow(` ${currentVersion} → ${latest} `) +
      chalk.gray(`run ${chalk.cyan('nova update')}`);

    const columns = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    // Strip ANSI for length calculation
    const plain = msg.replace(/\x1b\[[0-9;]*m/g, '');
    const x = Math.max(columns - plain.length - 1, 0);

    function renderBanner() {
      if (!process.stdout.isTTY) return;
      // Save cursor, move to bottom-right, print, restore cursor
      process.stdout.write(
        `\x1b7\x1b[${rows};${x}H${msg}\x1b8`
      );
    }

    // Render immediately and refresh every 5s (in case terminal redraws)
    renderBanner();
    updateBannerInterval = setInterval(renderBanner, 5_000);

    // Clean up on exit
    process.on('exit', () => {
      if (updateBannerInterval) clearInterval(updateBannerInterval);
    });
  } catch {
    // Silent
  }
}
