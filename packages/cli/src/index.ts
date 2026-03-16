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
import { runSetup } from './setup.js';

export { ConfigReader } from './config.js';
export { NovaLogger } from './logger.js';
export { runSetup } from './setup.js';
export { promptAndScaffold } from './scaffold.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'),
) as { version: string };

export function createCli(): Command {
  const program = new Command();

  program
    .name('nova')
    .description('Nova Architect - AI-powered site creation assistant')
    .version(pkg.version);

  program
    .command('start', { isDefault: true })
    .description('Start Nova Architect')
    .action(async () => {
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
    .action(async () => {
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

  return program;
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = createCli();
  await program.parseAsync(argv);
}
