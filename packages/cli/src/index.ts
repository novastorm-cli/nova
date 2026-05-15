import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { DEPRECATION } from './strings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')) as {
  version: string;
};

export interface StartOptions {
  noOpen?: boolean | undefined;
  yes?: boolean | undefined;
  port?: string | undefined;
  proxyPort?: string | undefined;
  host?: string | undefined;
  noTelemetry?: boolean | undefined;
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

      // ── Banner (lazy — only loaded for the start command) ──────────
      const novaQuiet = process.env['NOVA_QUIET'] === '1';
      const stdoutIsTTY = process.stdout.isTTY === true;
      const suppressBanner = novaQuiet || !stdoutIsTTY;

      if (!suppressBanner) {
        const { BANNER } = await import('./banner.js');
        console.log(BANNER);
        const isLocal = !import.meta.url.includes('node_modules');
        if (isLocal) {
          console.log('\x1b[43m\x1b[30m  LOCAL BUILD  \x1b[0m');
        }
        console.log(`\x1b[90m  v${pkg.version}\x1b[0m\n`);
        // Non-blocking update check (fire-and-forget)
        if (!isLocal) {
          import('./commands/update.js')
            .then(({ checkForUpdates }) => checkForUpdates(pkg.version))
            .catch(() => {});
        }
      }

      const { startCommand } = await import('./commands/start.js');
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
    .command('init')
    .description('Initialize nova.toml with default configuration')
    .action(async () => {
      const { initCommand } = await import('./commands/init.js');
      await initCommand();
    });

  program
    .command('setup')
    .description('Run first-time interactive setup')
    .option(
      '-p, --provider <provider>',
      'AI provider: claude-cli, anthropic, openrouter, openai, ollama, deepseek',
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
        // Non-interactive mode — save config directly, but still generate
        // install-id and set telemetry defaults.
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const os = await import('node:os');
        const crypto = await import('node:crypto');
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

        // Generate install-id if missing
        const userNovaDir = path.join(os.homedir(), '.nova');
        await fs.mkdir(userNovaDir, { recursive: true });
        const installIdPath = path.join(userNovaDir, 'install-id');
        try {
          await fs.stat(installIdPath);
        } catch {
          await fs.writeFile(installIdPath, crypto.randomUUID() + '\n', 'utf-8');
        }

        // Set telemetry default in ~/.nova/config.toml if not present
        const userConfigPath = path.join(userNovaDir, 'config.toml');
        let userConfig: Record<string, unknown> = {};
        try {
          const raw = await fs.readFile(userConfigPath, 'utf-8');
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          userConfig = TOML.parse(raw) as Record<string, unknown>;
        } catch {
          // Start fresh
        }
        if (userConfig['telemetry'] === undefined) {
          userConfig['telemetry'] = { enabled: false };
          await fs.writeFile(
            userConfigPath,
            TOML.stringify(userConfig as import('@iarna/toml').JsonMap),
            'utf-8',
          );
        }

        console.log(`Saved ${opts.provider} config to .nova/config.toml`);
        return;
      }
      const { runSetup } = await import('./setup.js');
      await runSetup(undefined, { nonInteractive: rootOpts.yes === true });
    });

  program
    .command('status')
    .description('Show project status: stack, index, pending tasks')
    .action(async () => {
      const { statusCommand } = await import('./commands/status.js');
      await statusCommand();
    });

  program
    .command('license [subcommand] [key]')
    .description('Manage license: nova license [status|activate <key>]')
    .action(async (subcommand?: string, key?: string) => {
      const { licenseCommand } = await import('./commands/license.js');
      await licenseCommand(subcommand, key);
    });

  program
    .command('entity [subcommand] [name]')
    .description('Manage manifest entities: nova entity <add|list|remove> [name]')
    .action(async (subcommand?: string, name?: string) => {
      const { entityCommand } = await import('./commands/entity.js');
      await entityCommand(subcommand, name);
    });

  program
    .command('bible [subcommand]')
    .description('Read the Ambient Development manifesto: nova bible [--read]')
    .action(async (subcommand?: string) => {
      const { bibleCommand } = await import('./commands/bible.js');
      await bibleCommand(subcommand);
    });

  program
    .command('update')
    .description('Update Novastorm CLI to the latest version')
    .action(async () => {
      const { updateCommand } = await import('./commands/update.js');
      await updateCommand();
    });

  program
    .command('uninstall')
    .description('Uninstall Novastorm CLI from your system')
    .action(async () => {
      const { uninstallCommand } = await import('./commands/uninstall.js');
      await uninstallCommand();
    });

  program
    .command('doctor')
    .description('Run system diagnostics to check your Nova setup')
    .option('--json', 'Output results as JSON')
    .action(async (opts: { json?: boolean }) => {
      const { doctorCommand } = await import('./commands/doctor.js');
      await doctorCommand({ json: opts.json === true });
    });

  return program;
}

export async function run(argv: string[] = process.argv): Promise<void> {
  // Handle NOVA_NON_INTERACTIVE env var — inject --yes into argv before commander sees it
  if (process.env['NOVA_NON_INTERACTIVE'] === '1') {
    if (!argv.includes('--yes')) {
      argv = [...argv, '--yes'];
    }
  }

  const args = argv.slice(2);

  // ── Intercept removed commands (deprecated in v1.0) ──────────────
  const removedCommands = {
    chat: DEPRECATION.removedCommands.chat,
    tasks: DEPRECATION.removedCommands.tasks,
    watch: DEPRECATION.removedCommands.watch,
    review: DEPRECATION.removedCommands.review,
  } as const;

  const removedSubcommand = args.find((a) => !a.startsWith('-') && a in removedCommands) as
    | keyof typeof removedCommands
    | undefined;

  if (removedSubcommand) {
    console.error(removedCommands[removedSubcommand]);
    process.exit(2);
  }

  const program = createCli();
  await program.parseAsync(argv);
}
