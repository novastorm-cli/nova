import { exec } from 'node:child_process';
import * as path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  NovaEventBus,
  NovaDir,
  ProjectIndexer,
  Brain,
  ProviderFactory,
  type ProjectMap,
  type Observation,
  type NovaEvent,
  type TaskItem,
} from '@nova-architect/core';
import {
  DevServerRunner,
  ProxyServer,
  WebSocketServer,
} from '@nova-architect/proxy';
import { LicenseChecker } from '@nova-architect/licensing';
import { ConfigReader } from '../config.js';
import { NovaLogger } from '../logger.js';
import { promptAndScaffold } from '../scaffold.js';

const PROXY_PORT_OFFSET = 1;
function findOverlayScript(): string {
  const candidates = [
    // From cli/dist/ (when imported as module)
    path.resolve(import.meta.dirname, '..', '..', 'overlay', 'dist', 'nova-overlay.global.js'),
    // From cli/dist/bin/ (when run as binary)
    path.resolve(import.meta.dirname, '..', '..', '..', 'overlay', 'dist', 'nova-overlay.global.js'),
    // From cli/src/commands/ (dev mode)
    path.resolve(import.meta.dirname, '..', '..', '..', '..', 'overlay', 'dist', 'nova-overlay.global.js'),
  ];
  for (const p of candidates) {
    try {
      if (require('fs').existsSync(p)) return p;
    } catch {}
  }
  return candidates[0]; // fallback
}
const OVERLAY_SCRIPT_PATH = findOverlayScript();

export async function startCommand(): Promise<void> {
  const cwd = process.cwd();
  const eventBus = new NovaEventBus();
  const configReader = new ConfigReader();
  const novaDir = new NovaDir();
  const devServer = new DevServerRunner();
  const proxyServer = new ProxyServer();
  const wsServer = new WebSocketServer();
  const licenseChecker = new LicenseChecker();
  const indexer = new ProjectIndexer();
  const logger = new NovaLogger();
  const taskMap = new Map<string, TaskItem>();

  // ── 1. Read config ──────────────────────────────────────────────────
  const spinner = ora('Reading configuration...').start();
  const config = await configReader.read(cwd);
  spinner.succeed('Configuration loaded.');

  // ── 2. Check license ────────────────────────────────────────────────
  spinner.start('Checking license...');
  const license = await licenseChecker.check(cwd, config);

  if (!license.valid) {
    spinner.warn(
      chalk.yellow(
        `License warning: ${license.message ?? 'Invalid license.'} Running in degraded mode.`,
      ),
    );
  } else {
    spinner.succeed(`License OK (${license.tier}, ${license.devCount} dev(s)).`);
  }

  // ── 3. Detect stack first (before creating .nova/) ─────────────────
  spinner.start('Detecting project...');

  // Quick stack detection without full indexing
  const { StackDetector } = await import('@nova-architect/core');
  const stackDetector = new StackDetector();
  let stack = await stackDetector.detectStack(cwd);
  let detectedDevCommand = await stackDetector.detectDevCommand(stack, cwd);
  let detectedPort = await stackDetector.detectPort(stack, cwd);

  spinner.succeed(`Detecting project... ${chalk.cyan(stack.framework || 'unknown')} + ${chalk.cyan(stack.typescript ? 'TypeScript' : stack.language || 'unknown')}`);

  // Resolve dev command: prefer config, fall back to auto-detected
  let devCommand = config.project.devCommand || detectedDevCommand;
  let devPort = config.project.port || detectedPort;

  // ── 3b. Scaffold if no project found ──────────────────────────────
  if (!devCommand) {
    // Clean up .nova/ if it was created prematurely (scaffolders like create-next-app complain about non-empty dirs)
    if (novaDir.exists(cwd)) {
      await novaDir.clean(cwd);
    }

    const scaffolded = await promptAndScaffold(cwd);

    if (!scaffolded) {
      // User chose 'empty' — nothing more to do
      process.exit(0);
    }

    // Re-detect stack after scaffolding
    spinner.start('Re-detecting project...');
    stack = await stackDetector.detectStack(cwd);
    detectedDevCommand = await stackDetector.detectDevCommand(stack, cwd);
    detectedPort = await stackDetector.detectPort(stack, cwd);
    spinner.succeed(
      `Detecting project... ${chalk.cyan(stack.framework || 'unknown')} + ${chalk.cyan(stack.typescript ? 'TypeScript' : stack.language || 'unknown')}`,
    );

    devCommand = config.project.devCommand || detectedDevCommand;
    devPort = config.project.port || detectedPort;

    if (!devCommand) {
      console.error(
        chalk.red('No dev command found after scaffolding. Set project.devCommand in nova.toml or ensure package.json has a "dev" script.'),
      );
      process.exit(1);
    }
  }

  // ── 4. Initialize .nova/ and index project ────────────────────────
  spinner.start('Initializing .nova/ directory...');
  await novaDir.init(cwd);
  spinner.succeed('.nova/ directory ready.');

  spinner.start('Indexing project...');
  let projectMap: ProjectMap;
  try {
    projectMap = await indexer.index(cwd);
  } catch (err) {
    spinner.fail('Failed to index project.');
    throw err;
  }
  spinner.succeed('Project indexed.');

  const proxyPort = devPort + PROXY_PORT_OFFSET;

  // ── 5. Start dev server ─────────────────────────────────────────────
  spinner.start(`Starting dev server (${chalk.dim(devCommand)})...`);

  try {
    await devServer.spawn(devCommand, cwd, devPort);
  } catch (err) {
    spinner.fail('Dev server failed to start.');
    throw err;
  }
  spinner.succeed('Starting dev server... done');

  // ── 6. Start proxy server ──────────────────────────────────────────
  spinner.start('Starting proxy server...');
  try {
    await proxyServer.start(devPort, proxyPort, OVERLAY_SCRIPT_PATH);
  } catch (err) {
    spinner.fail('Proxy server failed to start.');
    await devServer.kill();
    throw err;
  }
  spinner.succeed(`Proxy ready at ${chalk.green(`localhost:${proxyPort}`)}`);

  // ── 6b. Start WebSocket server on proxy's HTTP server ──────────────
  const httpServer = proxyServer.getHttpServer();
  if (httpServer) {
    wsServer.start(httpServer);
  }

  // ── 7. Open browser ────────────────────────────────────────────────
  console.log(chalk.dim('Opening browser...'));
  const openUrl = `http://127.0.0.1:${proxyPort}`;
  if (process.platform === 'darwin') {
    // Try Chrome first, fall back to default browser
    exec(`open -a "Google Chrome" "${openUrl}" 2>/dev/null || open -a "Chromium" "${openUrl}" 2>/dev/null || open "${openUrl}"`);
  } else if (process.platform === 'win32') {
    exec(`start chrome "${openUrl}" 2>nul || start "${openUrl}"`);
  } else {
    exec(`google-chrome "${openUrl}" 2>/dev/null || chromium "${openUrl}" 2>/dev/null || xdg-open "${openUrl}"`);
  }

  // ── 8. Set up event loop ────────────────────────────────────────────
  // Check if API key is available; if not, run setup
  if (!config.apiKeys.key && config.apiKeys.provider !== 'ollama') {
    console.log(chalk.yellow('\nNo API key configured. Running setup...\n'));
    const { runSetup } = await import('../setup.js');
    await runSetup(cwd);
    // Re-read config after setup
    const updatedConfig = await configReader.read(cwd);
    config.apiKeys = updatedConfig.apiKeys;
  }

  const providerFactory = new ProviderFactory();
  let llmClient;
  try {
    llmClient = providerFactory.create(config.apiKeys.provider, config.apiKeys.key);
  } catch (err) {
    console.log(chalk.yellow('\nAI provider not configured. Nova is running without AI analysis.'));
    console.log(chalk.dim('Run "nova setup" to configure your API key.\n'));
    llmClient = null;
  }
  const brain = llmClient ? new Brain(llmClient) : null;

  // Wire WebSocket observations into EventBus
  wsServer.onObservation((observation: Observation) => {
    logger.logObservation(observation);
    eventBus.emit({ type: 'observation', data: observation });
  });

  // Handle observations: analyze and create tasks
  eventBus.on('observation', async (event) => {
    if (!brain) {
      console.log(chalk.yellow('Observation received but no AI configured. Run "nova setup" to add an API key.'));
      return;
    }
    try {
      logger.logAnalyzing(event.data.transcript);
      const tasks = await brain.analyze(event.data, projectMap);
      logger.logTasks(tasks);

      for (const task of tasks) {
        eventBus.emit({ type: 'task_created', data: task });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Analysis error: ${message}`));
    }
  });

  // Forward task events to overlay clients
  eventBus.on('task_created', (event) => {
    taskMap.set(event.data.id, event.data);
    logger.logTaskStarted(event.data);
    wsServer.sendEvent(event as NovaEvent);
  });

  eventBus.on('task_completed', (event) => {
    const task = taskMap.get(event.data.taskId);
    if (task) {
      task.commitHash = event.data.commitHash;
      logger.logTaskCompleted(task);
    }
    wsServer.sendEvent(event as NovaEvent);
  });

  eventBus.on('task_failed', (event) => {
    const task = taskMap.get(event.data.taskId);
    if (task) {
      task.error = event.data.error;
      logger.logTaskFailed(task);
    }
    wsServer.sendEvent(event as NovaEvent);
  });

  eventBus.on('file_changed', (event) => {
    logger.logFileChanged(event.data.filePath);
  });

  console.log(
    chalk.bold.green('\nReady! Click elements or speak to start building.'),
  );
  console.log(chalk.dim('Press Ctrl+C to stop.\n'));

  // ── 9. Handle Ctrl+C ───────────────────────────────────────────────
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(chalk.dim('\n\nShutting down Nova...'));

    try {
      await proxyServer.stop();
    } catch {
      // best-effort
    }

    try {
      await devServer.kill();
    } catch {
      // best-effort
    }

    console.log(chalk.dim('Goodbye!'));
    process.exit(0);
  };

  // Suppress dev server error on intentional shutdown
  devServer.onError((error) => {
    if (!shuttingDown) {
      console.error(chalk.red(`\nDev server error: ${error}`));
    }
  });

  // Handle Ctrl+C — must be registered BEFORE the keep-alive promise
  process.on('SIGINT', () => {
    shutdown().catch(() => process.exit(1));
  });
  process.on('SIGTERM', () => {
    shutdown().catch(() => process.exit(1));
  });

  // Force exit on second Ctrl+C
  let forceCount = 0;
  process.on('SIGINT', () => {
    forceCount++;
    if (forceCount >= 2) {
      console.log(chalk.dim('\nForce exit.'));
      process.exit(1);
    }
  });

  // Keep process alive
  await new Promise(() => {});
}
