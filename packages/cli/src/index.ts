import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { chatCommand } from './commands/chat.js';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { tasksCommand } from './commands/tasks.js';
import { reviewCommand } from './commands/review.js';
import { watchCommand } from './commands/watch.js';
import { licenseCommand } from './commands/license.js';
import { entityCommand } from './commands/entity.js';
import { bibleCommand } from './commands/bible.js';
import { updateCommand, checkForUpdates } from './commands/update.js';
import { uninstallCommand } from './commands/uninstall.js';
import { doctorCommand } from './commands/doctor.js';
import { runSetup } from './setup.js';

export { ConfigReader } from './config.js';
export { NovaLogger } from './logger.js';
export { runSetup } from './setup.js';
export { promptAndScaffold } from './scaffold.js';
export { ErrorAutoFixer } from './autofix.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')) as {
  version: string;
};

export interface StartOptions {
  noOpen?: boolean;
  yes?: boolean;
  port?: string;
  proxyPort?: string;
  host?: string;
  noTelemetry?: boolean;
}

export function createCli(): Command {
  const program = new Command();

  program
    .name('nova')
    .description('Novastorm — AI-powered site creation assistant')
    .version(pkg.version)
    .option('--no-open', 'Do not open browser on startup')
    .option('--yes', 'Skip all interactive prompts (use defaults)')
    .option('--port <number>', 'Dev server port')
    .option('--proxy-port <number>', 'Proxy server port')
    .option('--no-telemetry', 'Disable telemetry for this run')
    .option('--host <addr>', 'Proxy bind address', '127.0.0.1');

  program
    .command('start', { isDefault: true })
    .description('Start Novastorm')
    .action(async () => {
      const opts = program.opts<{
        open?: boolean;
        yes?: boolean;
        port?: string;
        proxyPort?: string;
        telemetry?: boolean;
        host?: string;
      }>();

      if (opts.telemetry === false) {
        process.env['NOVA_TELEMETRY'] = 'false';
      }

      await startCommand({
        noOpen: opts.open === false,
        yes: opts.yes === true,
        port: opts.port,
        proxyPort: opts.proxyPort,
        host: opts.host,
        noTelemetry: opts.telemetry === false,
      });
    });

  program
    .command('chat')
    .description('Open interactive chat mode')
    .action(async () => {
      await chatCommand();
    });

  program
    .command('init')
    .description('Initialize nova.toml with default configuration')
    .action(async () => {
      await initCommand();
    });

  program
    .command('setup')
    .description('Run first-time interactive setup')
    .option(
      '-p, --provider <provider>',
      'AI provider: claude-cli, anthropic, openrouter, openai, ollama',
    )
    .option('-k, --key <key>', 'API key')
    .action(async (opts: { provider?: string; key?: string }) => {
      const rootOpts = program.opts<{ yes?: boolean; telemetry?: boolean }>();
      if (rootOpts.telemetry === false) {
        process.env['NOVA_TELEMETRY'] = 'false';
      }
      if (
        opts.provider &&
        (opts.key || opts.provider === 'ollama' || opts.provider === 'claude-cli')
      ) {
        // Non-interactive mode
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const TOML = (await import('@iarna/toml')).default;
        const cwd = process.cwd();
        const novaDir = path.join(cwd, '.nova');
        await fs.mkdir(novaDir, { recursive: true });
        const config = { apiKeys: { provider: opts.provider, key: opts.key } };
        await fs.writeFile(
          path.join(novaDir, 'config.toml'),
          TOML.stringify(config as unknown as import('@iarna/toml').JsonMap),
          'utf-8',
        );
        console.log(`Saved ${opts.provider} config to .nova/config.toml`);
        return;
      }
      await runSetup(undefined, { nonInteractive: rootOpts.yes === true });
    });

  program
    .command('status')
    .description('Show project status: stack, index, pending tasks')
    .action(async () => {
      await statusCommand();
    });

  program
    .command('tasks')
    .description('Manage tasks')
    .action(async () => {
      await tasksCommand();
    });

  program
    .command('review')
    .description('Run code review')
    .action(async () => {
      await reviewCommand();
    });

  program
    .command('watch')
    .description('Watch for file changes')
    .action(async () => {
      await watchCommand();
    });

  program
    .command('license [subcommand] [key]')
    .description('Manage license: nova license [status|activate <key>]')
    .action(async (subcommand?: string, key?: string) => {
      await licenseCommand(subcommand, key);
    });

  program
    .command('entity [subcommand] [name]')
    .description('Manage manifest entities: nova entity <add|list|remove> [name]')
    .action(async (subcommand?: string, name?: string) => {
      await entityCommand(subcommand, name);
    });

  program
    .command('bible [subcommand]')
    .description('Read the Ambient Development manifesto: nova bible [--read]')
    .action(async (subcommand?: string) => {
      await bibleCommand(subcommand);
    });

  program
    .command('update')
    .description('Update Novastorm CLI to the latest version')
    .action(async () => {
      await updateCommand();
    });

  program
    .command('uninstall')
    .description('Uninstall Novastorm CLI from your system')
    .action(async () => {
      await uninstallCommand();
    });

  program
    .command('doctor')
    .description('Run system diagnostics to check your Nova setup')
    .option('--json', 'Output results as JSON')
    .action(async (opts: { json?: boolean }) => {
      await doctorCommand({ json: opts.json === true });
    });

  return program;
}

const BANNER = `\x1b[96m
███╗   ██╗ ██████╗ ██╗   ██╗ █████╗ ███████╗████████╗ ██████╗ ██████╗ ███╗   ███╗
████╗  ██║██╔═══██╗██║   ██║██╔══██╗██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗████╗ ████║
██╔██╗ ██║██║   ██║██║   ██║███████║███████╗   ██║   ██║   ██║██████╔╝██╔████╔██║
██║╚██╗██║██║   ██║╚██╗ ██╔╝██╔══██║╚════██║   ██║   ██║   ██║██╔══██╗██║╚██╔╝██║
██║ ╚████║╚██████╔╝ ╚████╔╝ ██║  ██║███████║   ██║   ╚██████╔╝██║  ██║██║ ╚═╝ ██║
╚═╝  ╚═══╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝╚══════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝
╔═══════════════════════════════════════════════════════════════════════════════════╗
║           A M B I E N T   D E V E L O P M E N T   T O O L                      ║
╚═══════════════════════════════════════════════════════════════════════════════════╝
\x1b[0m\x1b[90m  https://cli.novastorm.ai\x1b[0m
`;

export async function run(argv: string[] = process.argv): Promise<void> {
  // Handle NOVA_NON_INTERACTIVE env var — inject --yes into argv before commander sees it
  if (process.env['NOVA_NON_INTERACTIVE'] === '1') {
    if (!argv.includes('--yes')) {
      argv = [...argv, '--yes'];
    }
  }

  const args = argv.slice(2);

  // Determine whether to suppress the banner.
  // Banner is shown ONLY when ALL of these are true:
  //   1. NOVA_QUIET is not set (or is not '1')
  //   2. stdout is a TTY
  //   3. The subcommand IS "start" (or no explicit subcommand = default start)
  //   4. Not --version, --help, -V, -h
  const novaQuiet = process.env['NOVA_QUIET'] === '1';
  const stdoutIsTTY = process.stdout.isTTY === true;

  // Determine the subcommand: first non-flag arg that is a known command
  const knownCommands = [
    'start',
    'chat',
    'init',
    'setup',
    'status',
    'tasks',
    'review',
    'watch',
    'license',
    'entity',
    'bible',
    'update',
    'uninstall',
    'doctor',
  ];
  const subcommand = args.find((a) => !a.startsWith('-') && knownCommands.includes(a));
  const isStartOrDefault = !subcommand || subcommand === 'start';
  const isFlagOnly =
    args.includes('--version') ||
    args.includes('-V') ||
    args.includes('--help') ||
    args.includes('-h');

  const suppressBanner = novaQuiet || !stdoutIsTTY || !isStartOrDefault || isFlagOnly;

  if (!suppressBanner) {
    console.log(BANNER);
    const isLocal = !import.meta.url.includes('node_modules');
    if (isLocal) {
      console.log('\x1b[43m\x1b[30m  LOCAL BUILD  \x1b[0m');
    }
    console.log(`\x1b[90m  v${pkg.version}\x1b[0m\n`);
    // Non-blocking update check (fire-and-forget)
    if (!isLocal) {
      checkForUpdates(pkg.version).catch(() => {});
    }
  }
  const program = createCli();
  await program.parseAsync(argv);
}
