/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, no-empty */
import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'node:path';
import {
  NovaEventBus,
  NovaDir,
  ProjectIndexer,
  Brain,
  ProviderFactory,
  ExecutorPool,
  Lane1Executor,
  Lane2Executor,
  Lane5Executor,
  GitManager,
  AgentPromptLoader,
  PathGuard,
  ManifestStore,
  CommitQueue,
  EnvDetector,
  StackDetector,
  StructuredLogger,
  type Observation,
  type TaskItem,
} from '@novastorm-ai/core';
import { DevServerRunner, ProxyServer, WebSocketServer } from '@novastorm-ai/proxy';
import { LicenseChecker } from '@novastorm-ai/licensing';
import { ConfigReader } from '../config.js';
import { NovaLogger } from '../logger.js';
import { ErrorAutoFixer } from '../autofix.js';
import { NovaChat } from '../chat.js';
import { handleSettingsCommand } from '../settings.js';
import { PortManager } from '../boot/PortManager.js';
import { sendBootTelemetry } from '../boot/TelemetryEmitter.js';
import { runScaffold } from '../boot/ScaffoldRunner.js';
import { ensureDependencies } from '../boot/Installer.js';
import { openBrowser } from '../boot/BrowserOpener.js';
import { setupEventRouting } from '../boot/EventRouter.js';
import { isNonInteractive } from '../boot/utils.js';
import type { StartOptions } from '../index.js';
import { LogLevel } from '@novastorm-ai/core';

const logger = new StructuredLogger({
  isTTY: process.stderr?.isTTY ?? false,
  minLevel: process.env['NOVA_DEBUG'] === '1' ? LogLevel.DEBUG : LogLevel.INFO,
});

const PROXY_PORT_OFFSET = 1;

function findOverlayScript(): string {
  const candidates = [
    path.resolve(import.meta.dirname, '..', '..', 'overlay', 'dist', 'nova-overlay.global.js'),
    path.resolve(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'overlay',
      'dist',
      'nova-overlay.global.js',
    ),
    path.resolve(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      'overlay',
      'dist',
      'nova-overlay.global.js',
    ),
  ];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      if (require('fs').existsSync(p)) return p;
    } catch {}
  }
  return candidates[0]!;
}
const OVERLAY_SCRIPT_PATH = findOverlayScript();

// ──────────────────────────────────────────────────────────────────────

export async function startCommand(options: StartOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const eventBus = new NovaEventBus();
  const configReader = new ConfigReader();
  const novaDir = new NovaDir();
  const devServer = new DevServerRunner();
  const proxyServer = new ProxyServer();
  const wsServer = new WebSocketServer();

  let earlyExit = true;
  process.on('SIGINT', () => {
    if (earlyExit) {
      logger.info('\nShutting down...');
      devServer.kill().catch(() => {});
      process.exit(0);
    }
  });

  const licenseChecker = new LicenseChecker();
  const indexer = new ProjectIndexer();
  const novaLogger = new NovaLogger(logger);
  const taskMap = new Map<string, TaskItem>();
  const pendingTasks: TaskItem[] = [];
  const lastObservation: { current: Observation | null } = { current: null };
  const pendingMissionTaskId: { current: string | null } = { current: null };
  const sp = ora();

  // ── 1. Config & license ──────────────────────────────────────────
  sp.start('Reading configuration...');
  const config = await configReader.read(cwd);
  sp.succeed('Configuration loaded.');
  sp.start('Checking license...');
  const license = await licenseChecker.check(cwd, config);
  sp[license.valid ? 'succeed' : 'warn'](
    license.valid
      ? `License OK (${license.tier}, ${license.devCount} dev(s)).`
      : chalk.yellow(`License warning: ${license.message ?? 'Invalid license.'}`),
  );

  // ── 2. Telemetry (fire-and-forget) ───────────────────────────────
  void sendBootTelemetry(options, config, license, cwd);

  // ── 3. LLM provider ──────────────────────────────────────────────
  if (
    !config.apiKeys.key &&
    config.apiKeys.provider !== 'ollama' &&
    config.apiKeys.provider !== 'claude-cli'
  ) {
    if (isNonInteractive(options)) {
      logger.warn('\nNo API key configured. Running in non-interactive mode -- using defaults.\n');
    } else {
      logger.warn('\nNo API key configured. Running setup...\n');
      const { runSetup } = await import('../setup.js');
      await runSetup(cwd, { nonInteractive: false });
      config.apiKeys = (await configReader.read(cwd)).apiKeys;
    }
  }
  const providerFactory = new ProviderFactory();
  let llmClient: any;
  try {
    llmClient = providerFactory.create(config.apiKeys.provider, config.apiKeys.key);
  } catch {
    logger.warn('\nAI provider not configured. Nova is running without AI analysis.');
    logger.debug('Run "nova setup" to configure your API key.\n');
    llmClient = null;
  }
  const brain = llmClient ? new Brain(llmClient, eventBus, config.models.micro) : null;

  // ── 4. Stack detection ───────────────────────────────────────────
  sp.start('Detecting project...');
  const stackDetector = new StackDetector();
  const stack = await stackDetector.detectStack(cwd);
  let devCommand = config.project.devCommand || (await stackDetector.detectDevCommand(stack, cwd));
  let devPort = config.project.port || (await stackDetector.detectPort(stack, cwd));
  const stackLabel =
    [stack.framework, ...(stack.additionalStacks ?? [])]
      .filter((s) => s !== 'unknown')
      .join(' + ') || 'unknown';
  sp.succeed(
    `Detecting project... ${chalk.cyan(stackLabel)} (${chalk.dim(stack.typescript ? 'TypeScript' : stack.language || 'unknown')})`,
  );

  // ── 5. Scaffold if needed ────────────────────────────────────────
  const scaffResult = await runScaffold(cwd, config, options, devCommand, devPort);
  if (scaffResult) {
    devCommand = scaffResult.devCommand;
    devPort = scaffResult.devPort;
  }

  // ── 6. Initialize .nova and index ────────────────────────────────
  sp.start('Initializing .nova/ directory...');
  await novaDir.init(cwd);
  sp.succeed('.nova/ directory ready.');
  sp.start('Indexing project...');
  const projectMap = await indexer.index(cwd, {
    ...(config.project.frontend !== undefined ? { frontend: config.project.frontend } : {}),
    ...(config.project.backends !== undefined ? { backends: config.project.backends } : {}),
  });
  sp.succeed('Project indexed.');

  // ── 7. RAG indexing ──────────────────────────────────────────────

  let ragIndexer: any = null; // eslint-disable-line no-useless-assignment
  try {
    const { RagIndexer, VectorStore, createEmbeddingService } = await import('@novastorm-ai/core');
    let embProvider: 'openai' | 'ollama' | 'tfidf' = 'tfidf';
    let embKey: string | undefined, embUrl: string | undefined;
    try {
      const r = await fetch('http://127.0.0.1:11434/api/tags');
      if (r.ok) {
        embProvider = 'ollama';
        embUrl = 'http://127.0.0.1:11434';
      }
    } catch {}
    if (embProvider === 'tfidf') {
      const k =
        config.apiKeys.provider === 'openai' ? config.apiKeys.key : process.env.OPENAI_API_KEY;
      if (k) {
        embProvider = 'openai';
        embKey = k;
      }
    }
    const embSvc = createEmbeddingService({
      provider: embProvider,
      ...(embKey !== undefined ? { apiKey: embKey } : {}),
      ...(embUrl !== undefined ? { baseUrl: embUrl } : {}),
    });
    const vs = new VectorStore();
    ragIndexer = new RagIndexer(embSvc, vs);
    const pLabel =
      embProvider === 'openai' ? 'OpenAI' : embProvider === 'ollama' ? 'Ollama' : 'TF-IDF';
    sp.start(`Building RAG index (${pLabel})...`);
    await ragIndexer.index(cwd, projectMap);
    sp.succeed(`RAG index built: ${vs.getRecordCount()} chunks (${pLabel}).`);
  } catch (err) {
    sp.warn(`RAG indexing skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 8. Project analysis ──────────────────────────────────────────
  const { ProjectAnalyzer } = await import('@novastorm-ai/core');
  const { ProjectMapApi } = await import('@novastorm-ai/proxy');
  const projectMapApi = new ProjectMapApi();
  const projectAnalyzer = new ProjectAnalyzer();
  sp.start('Analyzing project structure...');
  const analysis = await projectAnalyzer.analyze(cwd, projectMap);
  sp.succeed(`Project analyzed: ${analysis.fileCount} files, ${analysis.methods.length} methods.`);

  // ── 9. Ports ─────────────────────────────────────────────────────
  if (options.port) {
    devPort = parseInt(options.port, 10);
    if (isNaN(devPort) || devPort <= 0 || devPort > 65535) {
      logger.error(`Invalid port: ${options.port}`);
      process.exit(1);
    }
  }
  let proxyPort: number;
  if (options.proxyPort) {
    proxyPort = parseInt(options.proxyPort, 10);
    if (isNaN(proxyPort) || proxyPort <= 0 || proxyPort > 65535) {
      logger.error(`Invalid proxy port: ${options.proxyPort}`);
      process.exit(1);
    }
  } else {
    proxyPort = devPort + PROXY_PORT_OFFSET;
  }
  const pair = await acquirePorts(devPort, proxyPort, options);
  devPort = pair.devPort;
  proxyPort = pair.proxyPort;

  // ── 10. Install deps ─────────────────────────────────────────────
  await ensureDependencies(cwd, stack, options, llmClient);

  // ── 11. Dev server ───────────────────────────────────────────────
  sp.start(`Starting dev server (${chalk.dim(devCommand)})...`);
  try {
    await devServer.spawn(devCommand, cwd, devPort);
  } catch (err) {
    sp.fail('Dev server failed to start.');
    await recoverDevServer(err, devCommand, cwd, devPort, options, llmClient, devServer);
  }
  const actualPort = devServer.getActualPort();
  if (actualPort && actualPort !== devPort) {
    sp.succeed(`Dev server started on port ${chalk.yellow(actualPort)}`);
    devPort = actualPort;
    proxyPort = devPort + PROXY_PORT_OFFSET;
  } else {
    sp.succeed('Dev server started');
  }

  // ── 12. Proxy & WS ───────────────────────────────────────────────
  sp.start('Starting proxy server...');
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost')
    logger.warn(
      `\n  ⚠ Binding proxy to ${host} -- accessible from other devices on the network.\n`,
    );
  const sessionToken = randomBytes(32).toString('hex');
  await writeFile(path.join(novaDir.getPath(cwd), 'session-token'), sessionToken, { mode: 0o600 });
  proxyServer.setSessionToken(sessionToken);
  proxyServer.setConfirmTasks(config.behavior.confirmTasks);
  wsServer.setSessionToken(sessionToken);
  wsServer.setProxyPort(proxyPort);
  await proxyServer.start(devPort, proxyPort, OVERLAY_SCRIPT_PATH, host);
  sp.succeed(`Proxy ready at ${chalk.green(`localhost:${proxyPort}`)}`);
  const httpServer = proxyServer.getHttpServer();
  if (httpServer) wsServer.start(httpServer);

  proxyServer.setProjectMapApi(projectMapApi);
  const { GraphStore, SearchRouter } = await import('@novastorm-ai/core');
  const gs = new GraphStore(novaDir.getPath(cwd));
  projectMapApi.setGraphStore(gs);
  projectMapApi.setSearchRouter(new SearchRouter(gs));
  projectMapApi.setAnalysis(analysis);
  setTimeout(
    () =>
      wsServer.sendEvent({
        type: 'analysis_complete',
        data: { fileCount: analysis.fileCount, methodCount: analysis.methods.length },
      }),
    2000,
  );

  // ── 13. Browser ──────────────────────────────────────────────────
  await openBrowser(`http://localhost:${proxyPort}`, {
    ...(options.noOpen !== undefined ? { noOpen: options.noOpen } : {}),
  });

  // ── 14. Git ──────────────────────────────────────────────────────
  try {
    (await import('node:child_process')).execSync('git rev-parse --git-dir', {
      cwd,
      stdio: 'ignore',
    });
  } catch {
    const { execSync } = await import('node:child_process');
    execSync('git init', { cwd, stdio: 'ignore' });
    execSync('git add -A && git commit -m "Initial commit (before Nova)" --allow-empty', {
      cwd,
      stdio: 'ignore',
      shell: '/bin/sh',
    });
  }
  const gitManager = new GitManager(cwd);
  try {
    logger.debug(
      `Working on branch: ${await gitManager.createBranch(config.behavior.branchPrefix)}`,
    );
  } catch {}

  // ── 15. Executor & AutoFixer ─────────────────────────────────────
  let executorPool: any = null;
  let autoFixer: any = null;
  const commitQueue = new CommitQueue(
    gitManager,
    {
      ...(config.git?.allowProtectedBranchCommits !== undefined
        ? { allowProtectedBranchCommits: config.git.allowProtectedBranchCommits }
        : {}),
    },
    undefined,
    eventBus,
  );
  if (llmClient) {
    const pathGuard = new PathGuard(cwd);
    if (config.project.frontend) pathGuard.allow(resolve(cwd, config.project.frontend));
    for (const b of config.project.backends ?? []) pathGuard.allow(resolve(cwd, b));
    const manifestStore = new ManifestStore();
    const manifest = await manifestStore.load(cwd);
    if (manifest?.boundaries) pathGuard.loadBoundaries(manifest.boundaries);
    const agentPromptLoader = new AgentPromptLoader();

    // ── Lane 5 (mission) executor ──────────────────────────────────
    const missionConfig = {
      enabled: config.mission?.enabled ?? false,
      autoApprove: config.mission?.autoApprove ?? false,
      maxIterations: config.mission?.maxIterations ?? 5,
    };
    let lane5Executor: Lane5Executor | undefined;
    if (missionConfig.enabled) {
      lane5Executor = new Lane5Executor(
        cwd,
        llmClient,
        gitManager,
        eventBus,
        config.models.orchestrator ?? config.models.strong,
        missionConfig,
        agentPromptLoader,
        pathGuard,
        commitQueue,
        undefined, // logger
        config.models.standard,
      );
    }

    executorPool = new ExecutorPool(
      new Lane1Executor(cwd, pathGuard),
      new Lane2Executor(cwd, llmClient, gitManager, pathGuard, commitQueue),
      eventBus,
      undefined, // logger
      llmClient,
      gitManager,
      cwd,
      config.models.micro,
      config.models.standard,
      config.models.strong,
      agentPromptLoader,
      pathGuard,
      undefined, // lane4
      lane5Executor, // lane5
      commitQueue,
    );

    autoFixer = new ErrorAutoFixer(
      cwd,
      llmClient,
      gitManager,
      eventBus,
      wsServer,
      projectMap,
      commitQueue,
      config.models.micro,
      undefined, // logger
      lane5Executor,
      missionConfig,
    );
  }

  devServer.onOutput((o: string) => autoFixer?.handleOutput(o));

  const envDetector = new EnvDetector();
  wsServer.onSecretsSubmit((secrets: Record<string, string>) => {
    envDetector.writeEnvLocal(cwd, secrets);
    envDetector.ensureGitignored(cwd);
    wsServer.sendEvent({
      type: 'status',
      data: { message: `Saved ${Object.keys(secrets).length} secret(s)` },
    });
  });

  // ── 16. Event routing ────────────────────────────────────────────
  setupEventRouting({
    wsServer,
    eventBus,
    brain,
    config,
    options,
    gitManager,
    executorPool,
    autoFixer,
    devServer,
    logger: novaLogger,
    projectMap,
    taskMap,
    pendingTasks,
    pendingMissionTaskId,
    lastObservation,
  });

  logger.info('\nReady! Click elements or speak to start building.');
  logger.debug('Type commands below, or use /help for available commands.\n');

  // ── Startup health check ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/require-await
  setTimeout(async () => {
    const logs = devServer.getLogs();
    const errors = logs
      .split('\n')
      .filter(
        (l) =>
          /error|Error|failed|Module not found|SyntaxError|Cannot find/i.test(l) &&
          !/warning|warn|deprecat/i.test(l),
      )
      .slice(-10)
      .join('\n')
      .trim();
    if (!errors || !llmClient) return;
    logger.error('\n[Nova] Build errors detected at startup:');
    logger.debug(errors.slice(0, 500));
    // Route to autofixer (bypasses Brain → no clarifying questions, direct fix).
    // When autoFixer is available (providers configured), use it so the
    // fix goes through Lane3Executor with the strict "no questions" prompt.
    if (autoFixer) {
      autoFixer.forceFixNow(errors);
    } else {
      // Fallback: route through Brain (may produce clarifying questions).
      const fixTask: TaskItem = {
        id: crypto.randomUUID(),
        description: `Fix build errors: ${errors.slice(0, 500)}`,
        files: [],
        type: 'multi_file',
        lane: 3,
        status: 'pending',
      };
      pendingTasks.push(fixTask);
      if (isNonInteractive(options) || config.behavior.confirmTasks === false) {
        eventBus.emit({
          type: 'observation',
          data: {
            screenshot: Buffer.alloc(0),
            transcript: fixTask.description,
            currentUrl: `file://${cwd}`,
            timestamp: Date.now(),
            autoExecute: true,
          } as any,
        });
      } else {
        wsServer.sendEvent({
          type: 'pending_tasks',
          data: {
            tasks: [{ id: fixTask.id, description: 'Fix startup build errors', lane: 3 }],
            message: `Press Y to execute -- ${fixTask.description.slice(0, 200)}`,
          },
        });
      }
    }
  }, 4000);

  // ── 17. Chat & shutdown ──────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('\n\nShutting down...');
    try {
      await proxyServer.stop();
    } catch {}
    try {
      await devServer.kill();
    } catch {}
    process.exit(0);
  };
  devServer.onError((e: string) => {
    if (!shuttingDown)
      wsServer.sendEvent({ type: 'status', data: { message: `Dev server error: ${e}` } });
  });

  const chat = new NovaChat();
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  chat.onCommand(async (cmd) => {
    switch (cmd.type) {
      case 'text':
        if (!brain) {
          chat.log(chalk.yellow('AI not configured. Use /settings to add a key.'));
          return;
        }
        lastObservation.current = {
          screenshot: Buffer.alloc(0),
          transcript: cmd.args,
          currentUrl: `file://${cwd}`,
          timestamp: Date.now(),
        };
        eventBus.emit({ type: 'observation', data: lastObservation.current });
        break;
      case 'confirm':
        if (pendingTasks.length === 0) {
          chat.log(chalk.dim('Nothing to confirm.'));
          return;
        }
        eventBus.emit({
          type: 'observation',
          data: {
            screenshot: Buffer.alloc(0),
            transcript: pendingTasks.map((t) => t.description).join('; '),
            currentUrl: `file://${cwd}`,
            timestamp: Date.now(),
            autoExecute: true,
          } as any,
        });
        pendingTasks.length = 0;
        break;
      case 'cancel':
        pendingTasks.length = 0;
        chat.log(chalk.yellow('Tasks cancelled.'));
        break;
      case 'settings':
        chat.log(await handleSettingsCommand(cmd.args, config, configReader, cwd));
        break;
      case 'help':
        chat.log(
          [
            chalk.bold('\nNova Commands\n'),
            `  ${chalk.cyan('text')}    Send as code change request`,
            `  ${chalk.cyan('/settings')} View/change settings`,
            `  ${chalk.cyan('/help')}    Show this help`,
            `  ${chalk.cyan('y/n')}     Confirm/cancel pending`,
            '',
          ].join('\n'),
        );
        break;
      case 'status':
        chat.log(
          [
            chalk.bold('\nStatus\n'),
            `  Project: ${cwd}`,
            `  Stack: ${projectMap.stack.framework}`,
            `  Dev: localhost:${devPort}`,
            `  Proxy: localhost:${proxyPort}`,
            `  Pending: ${pendingTasks.length}`,
            '',
          ].join('\n'),
        );
        break;
      case 'map':
        chat.log(chalk.cyan(`Opening project map: http://localhost:${proxyPort}/nova-project-map`));
        break;
    }
  });
  chat.start();
  earlyExit = false;

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
  let fc = 0;
  process.on('SIGINT', () => {
    if (++fc >= 2) process.exit(1);
  });

  if (isNonInteractive(options) && !process.stdin.isTTY) {
    if (process.stdin.readableEnded) {
      await new Promise((r) => setTimeout(r, 500));
      await shutdown();
    } else {
      process.stdin.resume();
      // Wait up to 120 s for autofix / LLM calls to complete.
      // The autofixer can take > 30 s for Lane3 multi-file LLM calls.
      await Promise.race([
        new Promise<void>((r) => {
          process.stdin.on('close', r);
          process.stdin.on('end', r);
        }),
        new Promise((r) => setTimeout(r, 120_000)),
      ]);
      await shutdown();
    }
  } else {
    await new Promise(() => {});
  }
}

// ── Local helpers (kept in this file to stay ≤400 lines) ──────────────

async function acquirePorts(
  devPort: number,
  proxyPort: number,
  options: StartOptions,
): Promise<{ devPort: number; proxyPort: number }> {
  const sp = ora('Checking ports...').start();
  const dBusy = await PortManager.isPortInUse(devPort);
  const pBusy = await PortManager.isPortInUse(proxyPort);
  if (!dBusy && !pBusy) {
    sp.succeed('Ports available');
    return { devPort, proxyPort };
  }

  if (isNonInteractive(options)) {
    sp.warn('Port conflict -- auto-resolving');
    const pair = await PortManager.findFreePortPair(devPort, proxyPort);
    logger.warn(`  Auto-selected: dev=${pair.devPort}, proxy=${pair.proxyPort}`);
    return pair;
  }

  sp.fail('Port conflict');
  const busy = [];
  if (dBusy) busy.push(devPort);
  if (pBusy) busy.push(proxyPort);
  logger.error(`  In use: ${busy.join(', ')}`);

  const { select, input } = await import('@inquirer/prompts');
  while (true) {
    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { name: `[k] Kill processes on ${busy.join(', ')}`, value: 'kill' },
        { name: '[p] Use different port', value: 'change' },
        { name: '[c] Cancel', value: 'exit' },
      ],
    }).catch(() => 'exit');
    if (action === 'exit') process.exit(0);
    if (action === 'kill') {
      try {
        for (const p of busy) await PortManager.killPort(p);
        logger.info('Killed.');
        return { devPort, proxyPort };
      } catch {
        logger.error('Failed to kill.');
      }
    }
    if (action === 'change') {
      try {
        const np = await input({ message: 'Dev server port:', default: String(devPort + 10) });
        return { devPort: parseInt(np, 10), proxyPort: parseInt(np, 10) + (proxyPort - devPort) };
      } catch {
        process.exit(0);
      }
    }
  }
}

async function recoverDevServer(
  err: unknown,
  devCommand: string,
  cwd: string,
  devPort: number,
  options: StartOptions,
  llmClient: any,
  devServer: DevServerRunner,
): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(`\n${msg}`);
  if (isNonInteractive(options)) {
    logger.error('Cannot recover in non-interactive mode.');
    process.exit(1);
  }

  const { select, input } = await import('@inquirer/prompts');
  const choices: Array<{ name: string; value: string }> = [];
  if (/EADDRINUSE|address already in use/i.test(msg)) {
    choices.push(
      { name: `[k] Kill port ${devPort} & retry`, value: 'kill-retry' },
      { name: '[p] Change port', value: 'change-port' },
    );
  }
  if (/Cannot find module|MODULE_NOT_FOUND/i.test(msg))
    choices.push({ name: 'Run npm install & retry', value: 'install-retry' });
  if (/EJSONPARSE|JSON/.test(msg))
    choices.push({ name: 'Fix package.json & retry', value: 'fix-json-retry' });
  if (llmClient) choices.push({ name: 'AI fix', value: 'ai-fix' });
  choices.push({ name: 'Exit', value: 'exit' });

  while (true) {
    const action = await select({ message: 'What would you like to do?', choices }).catch(
      () => 'exit',
    );
    if (action === 'exit') process.exit(0);
    try {
      if (action === 'kill-retry') {
        await PortManager.killPort(devPort);
        await devServer.spawn(devCommand, cwd, devPort);
        return;
      }
      if (action === 'change-port') {
        const np = await input({ message: 'Port:', default: String(devPort + 10) });
        await devServer.spawn(devCommand, cwd, parseInt(np, 10));
        return;
      }
      if (action === 'install-retry') {
        (await import('node:child_process')).execSync('npm install', { cwd, stdio: 'inherit' });
        await devServer.spawn(devCommand, cwd, devPort);
        return;
      }
      if (action === 'fix-json-retry') {
        const { readFileSync, writeFileSync } = await import('node:fs');
        const p = path.join(cwd, 'package.json');
        const c = readFileSync(p, 'utf-8').replace(/,(\s*[}\]])/g, '$1');
        writeFileSync(p, c);
        if (llmClient) {
          try {
            JSON.parse(c);
          } catch {
            const resp = await llmClient.chat(
              [
                { role: 'system', content: 'Fix this JSON. Output ONLY valid JSON.' },
                { role: 'user', content: c },
              ],
              { temperature: 0, maxTokens: 4096 },
            );
            let f = resp.content.trim();
            const m = f.match(/```(?:json)?\n([\s\S]*?)```/);
            if (m) f = m[1].trim();
            JSON.parse(f);
            writeFileSync(p, f);
          }
        }
        (await import('node:child_process')).execSync('npm install', { cwd, stdio: 'pipe' });
        await devServer.spawn(devCommand, cwd, devPort);
        return;
      }
      if (action === 'ai-fix') {
        const desc = await input({ message: 'Describe what to fix:' });
        if (!desc.trim() || !llmClient) continue;
        const resp = await llmClient.chat(
          [
            {
              role: 'system',
              content: 'Output fixed files:\n=== FILE: path ===\ncontent\n=== END FILE ===',
            },
            { role: 'user', content: `Error: ${msg.slice(0, 800)}\nUser: ${desc.trim()}` },
          ],
          { temperature: 0, maxTokens: 4096 },
        );
        const { mkdirSync, writeFileSync: wf } = await import('node:fs');
        let m: RegExpExecArray | null;
        const re = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g;
        while ((m = re.exec(resp.content)) !== null) {
          mkdirSync(path.dirname(path.join(cwd, m[1]!.trim())), { recursive: true });
          wf(path.join(cwd, m[1]!.trim()), m[2]!);
        }
        await devServer.spawn(devCommand, cwd, devPort);
        return;
      }
    } catch (e) {
      logger.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
