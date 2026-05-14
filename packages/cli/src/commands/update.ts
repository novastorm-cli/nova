import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
import { StructuredLogger } from '@novastorm-ai/core';

const logger = new StructuredLogger({ isTTY: process.stderr?.isTTY ?? false });

const PKG_NAME = '@novastorm-ai/cli';

// ── PM detection ─────────────────────────────────────────────────────────

/**
 * Supported package managers and their update/install commands.
 */
type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'volta' | 'asdf';

interface PmInfo {
  name: string;
  /** The command to run for a global install/update. */
  installCmd: string[];
  /** User-facing update instruction shown on EACCES. */
  remedy: string;
}

const PM_COMMANDS: Record<PackageManager, PmInfo> = {
  npm: {
    name: 'npm',
    installCmd: ['npm', 'install', '-g', `${PKG_NAME}@latest`],
    remedy: [
      `It looks like Nova was installed globally with \`npm\`.`,
      `Run: \`sudo npm install -g ${PKG_NAME}@latest\``,
      `OR consider using a Node version manager (nvm, asdf, volta) that does not require sudo.`,
    ].join('\n'),
  },
  pnpm: {
    name: 'pnpm',
    installCmd: ['pnpm', 'add', '-g', `${PKG_NAME}@latest`],
    remedy: [
      `It looks like Nova was installed with \`pnpm\`. The global install location requires write permissions.`,
      `Run: \`sudo pnpm add -g ${PKG_NAME}@latest\``,
      `OR configure a user-writable global prefix: \`pnpm config set global-bin-dir ~/.local/bin\``,
    ].join('\n'),
  },
  yarn: {
    name: 'yarn',
    installCmd: ['yarn', 'global', 'add', `${PKG_NAME}@latest`],
    remedy: [
      `It looks like Nova was installed with \`yarn\`. The global install location requires write permissions.`,
      `Run: \`sudo yarn global add ${PKG_NAME}@latest\``,
      `OR consider using a Node version manager (nvm, asdf, volta) that does not require sudo.`,
    ].join('\n'),
  },
  volta: {
    name: 'volta',
    installCmd: ['volta', 'install', `${PKG_NAME}@latest`],
    remedy: [
      `It looks like Nova was installed with \`volta\`.`,
      `Run: \`volta install ${PKG_NAME}@latest\``,
      `If the issue persists, check that your Volta installation at ~/.volta is writable by your user.`,
    ].join('\n'),
  },
  asdf: {
    name: 'asdf',
    installCmd: ['npm', 'install', '-g', `${PKG_NAME}@latest`],
    remedy: [
      `It looks like Nova was installed under \`asdf\`. Asdf-managed Node installs should be user-writable.`,
      `Run: \`npm install -g ${PKG_NAME}@latest\``,
      `If the issue persists, try: \`asdf reshim nodejs\` and re-run the command.`,
    ].join('\n'),
  },
};

/**
 * Detect which package manager was used to install the Nova CLI.
 *
 * Strategy:
 * 1. Honour `_NOVA_TEST_PM` env var (for tests).
 * 2. Inspect the real path of the current module for PM signatures
 *    (pnpm store, yarn global dir, volta shims, asdf shims).
 * 3. Default to npm.
 */
function detectPackageManager(): PackageManager {
  // Allow tests to override
  const testPm = process.env['_NOVA_TEST_PM'];
  if (testPm && testPm in PM_COMMANDS) {
    return testPm as PackageManager;
  }

  try {
    // Resolve the real path of the Nova package directory.
    // import.meta.url → update.js location → package root.
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = resolve(__dirname, '..');

    let real = realpathSync(pkgRoot);

    // Walk up, looking for PM signatures
    while (real && real !== '/') {
      const segment = real.split('/').pop() ?? '';

      // Volta stores tools in ~/.volta/tools/image/node/<ver>/lib/node_modules/...
      if (real.includes('/.volta/')) return 'volta';

      // asdf stores in ~/.asdf/installs/node/<ver>/lib/node_modules/...
      if (real.includes('/.asdf/')) return 'asdf';

      // pnpm global store: ~/.pnpm or similar; also check for pnpm-store markers
      if (segment.startsWith('.pnpm') || real.includes('/pnpm-global/')) {
        return 'pnpm';
      }

      // yarn global: often under ~/.yarn/ or ~/.config/yarn/global/
      if (real.includes('/.yarn/') || real.includes('/yarn/global/')) {
        return 'yarn';
      }

      real = dirname(real);
    }
  } catch {
    // realpathSync may throw if path doesn't exist; fall through to default
  }

  return 'npm';
}

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

interface InstallResult {
  ok: boolean;
  output: string;
  /** Exit code from the child process (0 on success). */
  exitCode: number;
}

function runPmInstall(pm: PackageManager): Promise<InstallResult> {
  const { installCmd } = PM_COMMANDS[pm];
  const cmd = installCmd[0];
  const args = installCmd.slice(1);

  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) {
        const exitCode =
          typeof (error as { code?: number }).code === 'number'
            ? (error as { code: number }).code
            : 1;
        const combined = (stderr || error.message).trim();
        resolve({ ok: false, output: combined, exitCode });
      } else {
        resolve({ ok: true, output: stdout, exitCode: 0 });
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
  const { dirname: _dirname, resolve: _resolve } = await import('node:path');
  const { fileURLToPath: _fileURLToPath } = await import('node:url');
  const __dirname = _dirname(_fileURLToPath(import.meta.url));
  let currentVersion = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(_resolve(__dirname, '..', 'package.json'), 'utf-8')) as {
      version: string;
    };
    currentVersion = pkg.version;
  } catch {
    /* ignore */
  }

  if (!isNewer(latest, currentVersion)) {
    spinner.succeed(`Already on the latest version ${chalk.green(currentVersion)}`);
    return;
  }

  const pm = detectPackageManager();
  spinner.text = `Updating ${chalk.gray(currentVersion)} → ${chalk.green(latest)}...`;

  const result = await runPmInstall(pm);

  if (result.ok) {
    spinner.succeed(`Updated to ${chalk.green(latest)}`);
    return;
  }

  // ── EACCES handling ─────────────────────────────────────────────────
  // Check if the error from execFile indicates a permissions issue.
  // We inspect the combined output and exit code.
  const isPermError = result.exitCode === 243 || /EACCES|permission denied/i.test(result.output);

  if (isPermError) {
    spinner.fail('Permission denied — cannot write to the global install location.');
    logger.info('');
    logger.warn(PM_COMMANDS[pm].remedy);
    process.exit(result.exitCode);
  }

  // ── Non-EACCES failure ─────────────────────────────────────────────
  spinner.fail('Update failed. Try manually:');
  logger.info(`  ${PM_COMMANDS[pm].installCmd.join(' ')}`);
  if (result.output) {
    logger.info(result.output);
  }
  process.exit(result.exitCode);
}

let updateBannerInterval: ReturnType<typeof setInterval> | null = null;

export async function checkForUpdates(currentVersion: string): Promise<void> {
  try {
    const latest = await getLatestVersion();
    if (!latest || !isNewer(latest, currentVersion)) return;

    const msg =
      chalk.bgYellow.black(` UPDATE `) +
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
      process.stdout.write(`\x1b7\x1b[${rows};${x}H${msg}\x1b8`);
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
