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
import { runSetup } from './setup.js';

export { ConfigReader } from './config.js';
export { NovaLogger } from './logger.js';
export { runSetup } from './setup.js';
export { promptAndScaffold } from './scaffold.js';
export { ErrorAutoFixer } from './autofix.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'),
) as { version: string };

export function createCli(): Command {
  const program = new Command();

  program
    .name('nova')
    .description('Nova Architect - AI-powered site creation assistant')
    .version(pkg.version)
    .option('--no-telemetry', 'Disable telemetry for this run');

  program
    .command('start', { isDefault: true })
    .description('Start Nova Architect')
    .action(async () => {
      if (!program.opts().telemetry) {
        process.env['NOVA_TELEMETRY'] = 'false';
      }
      await startCommand();
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
    .option('-p, --provider <provider>', 'AI provider: claude-cli, anthropic, openrouter, openai, ollama')
    .option('-k, --key <key>', 'API key')
    .action(async (opts: { provider?: string; key?: string }) => {
      if (opts.provider && (opts.key || opts.provider === 'ollama' || opts.provider === 'claude-cli')) {
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
      await runSetup();
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
  // Suppress banner for --version / --help / -V / -h to keep output machine-parseable
  const args = argv.slice(2);
  const suppressBanner = args.includes('--version') || args.includes('-V')
    || args.includes('--help') || args.includes('-h');

  if (!suppressBanner) {
    console.log(BANNER);
    // Non-blocking update check (fire-and-forget)
    checkForUpdates(pkg.version).catch(() => {});
  }
  const program = createCli();
  await program.parseAsync(argv);
}
