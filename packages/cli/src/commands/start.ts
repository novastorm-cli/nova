import { exec } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import * as net from 'node:net';
import * as path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { resolve, join } from 'node:path';
import { input, select } from '@inquirer/prompts';
import TOML from '@iarna/toml';
import {
  NovaEventBus,
  NovaDir,
  ProjectIndexer,
  Brain,
  ProviderFactory,
  ExecutorPool,
  Lane1Executor,
  Lane2Executor,
  Lane3Executor,
  GitManager,
  AgentPromptLoader,
  PathGuard,
  ManifestStore,
  CommitQueue,
  type ProjectMap,
  type Observation,
  type NovaEvent,
  type TaskItem,
  type ExecutionResult,
  EnvDetector,
  StackDetector,
} from '@novastorm-ai/core';
import {
  DevServerRunner,
  ProxyServer,
  WebSocketServer,
} from '@novastorm-ai/proxy';
import { LicenseChecker, Telemetry, NudgeRenderer } from '@novastorm-ai/licensing';
import { ConfigReader } from '../config.js';
import { NovaLogger } from '../logger.js';
import { promptAndScaffold } from '../scaffold.js';
import { ErrorAutoFixer } from '../autofix.js';
import { NovaChat } from '../chat.js';
import { handleSettingsCommand } from '../settings.js';

const SELECT_THEME = {
  icon: { cursor: chalk.whiteBright('❯') },
  style: {
    highlight: (text: string) => chalk.whiteBright(text.replace(/\x1b\[\d+m/g, '')),
  },
  indexMode: 'hidden' as const,
};

const PROXY_PORT_OFFSET = 1;
const MAX_TASK_CONCURRENCY = 3;

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const executing = new Set<Promise<void>>();

  for (let i = 0; i < tasks.length; i++) {
    const index = i;
    const p = tasks[index]().then((result) => {
      results[index] = result;
      executing.delete(p);
    });
    executing.add(p);

    if (executing.size >= maxConcurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => { server.close(); resolve(false); });
    server.listen(port, '127.0.0.1');
  });
}
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

  // Register early Ctrl+C handler so it works during startup (before chat.start)
  let earlyExit = true;
  process.on('SIGINT', () => {
    if (earlyExit) {
      console.log(chalk.dim('\nShutting down...'));
      devServer.kill().catch(() => {});
      process.exit(0);
    }
  });
  const licenseChecker = new LicenseChecker();
  const indexer = new ProjectIndexer();
  const logger = new NovaLogger();
  const taskMap = new Map<string, TaskItem>();
  let pendingTasks: TaskItem[] = [];
  let lastObservation: Observation | null = null;

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

  // ── 2b. Send telemetry ──────────────────────────────────────────────
  if (config.telemetry.enabled && process.env['NOVA_TELEMETRY'] !== 'false') {
    const { createHash } = await import('node:crypto');
    const os = await import('node:os');
    const { execFile } = await import('node:child_process');

    const mac = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => !i?.internal && i?.mac !== '00:00:00:00:00:00')?.mac ?? '';
    const machineId = createHash('sha256')
      .update(os.hostname() + os.userInfo().username + mac)
      .digest('hex');

    let projectHash: string;
    try {
      const remoteUrl = await new Promise<string>((resolve, reject) => {
        execFile('git', ['remote', 'get-url', 'origin'], { cwd }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        });
      });
      projectHash = createHash('sha256').update(remoteUrl).digest('hex');
    } catch {
      projectHash = createHash('sha256').update(cwd).digest('hex');
    }

    const telemetry = new Telemetry();
    const cliPkg = await import('../../package.json', { with: { type: 'json' } }).catch(
      () => ({ default: { version: '0.0.1' } }),
    );

    telemetry
      .send({
        machineId,
        gitAuthors90d: license.devCount,
        projectHash,
        cliVersion: (cliPkg.default as { version: string }).version ?? '0.0.1',
        os: process.platform,
        timestamp: new Date().toISOString(),
        licenseKey: config.license?.key ?? process.env['NOVA_LICENSE_KEY'] ?? null,
      })
      .then((response) => {
        if (response && response.nudgeLevel > 0) {
          const nudgeRenderer = new NudgeRenderer();
          const nudgeMessage = nudgeRenderer.render({
            level: response.nudgeLevel,
            devCount: license.devCount,
            tier: license.tier,
            hasLicense: license.valid && license.tier !== 'free',
          });
          if (nudgeMessage) {
            console.log(chalk.yellow(`\n${nudgeMessage}\n`));
          }
        }
      })
      .catch(() => {}); // fire-and-forget
  }

  // ── 2c. Set up LLM provider (early — before scanning) ──────────────
  if (!config.apiKeys.key && config.apiKeys.provider !== 'ollama' && config.apiKeys.provider !== 'claude-cli') {
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
  const brain = llmClient ? new Brain(llmClient, eventBus, config.models.micro) : null;

  // ── 3. Detect stack first (before creating .nova/) ─────────────────
  spinner.start('Detecting project...');

  const stackDetector = new StackDetector();
  let stack = await stackDetector.detectStack(cwd);
  let detectedDevCommand = await stackDetector.detectDevCommand(stack, cwd);
  let detectedPort = await stackDetector.detectPort(stack, cwd);

  const allStacks = [stack.framework, ...(stack.additionalStacks ?? [])];
  const stackLabel = allStacks.filter(s => s !== 'unknown').join(' + ') || 'unknown';
  const langLabel = stack.typescript ? 'TypeScript' : stack.language || 'unknown';

  spinner.succeed(`Detecting project... ${chalk.cyan(stackLabel)} (${chalk.dim(langLabel)})`);

  if (stack.framework !== 'unknown') {
    console.log(chalk.green(`  Detected: ${stackLabel}`));
  } else {
    const dirFiles = readdirSync(cwd).slice(0, 10).join(', ');
    console.log(chalk.yellow(`  Could not detect framework. Files in directory: ${dirFiles}`));
  }

  // Resolve dev command: prefer config, fall back to auto-detected
  let devCommand = config.project.devCommand || detectedDevCommand;
  let devPort = config.project.port || detectedPort;

  // ── 3b. Scaffold if no project found ──────────────────────────────
  if (!devCommand) {
    // Check if directory already has project files
    const projectMarkers = ['package.json', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile'];
    const hasProjectFiles = projectMarkers.some(f => existsSync(join(cwd, f)))
      || readdirSync(cwd).some(f => f.endsWith('.sln') || f.endsWith('.csproj'));

    if (hasProjectFiles) {
      // Existing project but dev command unknown — ask user
      // Suggest a default based on detected stack
      const defaultCmd = stack.framework === 'dotnet' ? 'dotnet run'
        : stack.framework === 'django' ? 'python manage.py runserver'
        : stack.framework === 'fastapi' ? 'uvicorn main:app --reload'
        : stack.framework === 'flask' ? 'flask run'
        : stack.framework === 'rails' ? 'bin/rails server'
        : stack.framework === 'laravel' ? 'php artisan serve'
        : stack.framework === 'spring-boot' ? './mvnw spring-boot:run'
        : existsSync(join(cwd, 'package.json')) ? 'npm run dev'
        : '';

      const stackLabel = stack.framework !== 'unknown'
        ? ` (${chalk.cyan(stack.framework)} detected)`
        : '';

      let devCmd: string;
      try {
        devCmd = await input({
          message: `Dev command not found${stackLabel}. Enter your dev command:`,
          default: defaultCmd || undefined,
        });
      } catch {
        console.log('\nCancelled.');
        process.exit(0);
      }

      if (devCmd && devCmd.trim()) {
        devCommand = devCmd.trim();
        // Save to nova.toml for future runs
        try {
          const novaTomlPath = join(cwd, 'nova.toml');
          let tomlContent: Record<string, unknown> = {};
          if (existsSync(novaTomlPath)) {
            const { readFileSync } = await import('node:fs');
            tomlContent = TOML.parse(readFileSync(novaTomlPath, 'utf-8')) as Record<string, unknown>;
          }
          const project = (tomlContent['project'] as Record<string, unknown>) ?? {};
          project['devCommand'] = devCommand;
          tomlContent['project'] = project;
          await writeFile(novaTomlPath, TOML.stringify(tomlContent as TOML.JsonMap), 'utf-8');
          console.log(chalk.dim(`Saved devCommand to nova.toml`));
        } catch {
          // Non-critical — continue without saving
        }
      } else {
        console.error(chalk.red('Dev command is required. Add [project] devCommand = "..." to nova.toml'));
        process.exit(1);
      }
    } else {
      // Empty directory — scaffold as before
      // Clean up .nova/ if it was created prematurely (scaffolders like create-next-app complain about non-empty dirs)
      if (novaDir.exists(cwd)) {
        await novaDir.clean(cwd);
      }

      const scaffoldInfo = await promptAndScaffold(cwd);

      if (!scaffoldInfo.scaffolded) {
        // User chose 'empty' — nothing more to do
        process.exit(0);
      }

      // Apply frontend/backends from scaffold to config (for multi-stack projects)
      if (scaffoldInfo.frontend) config.project.frontend = scaffoldInfo.frontend;
      if (scaffoldInfo.backends) config.project.backends = scaffoldInfo.backends;

      // Re-detect stack after scaffolding
      spinner.start('Re-detecting project...');
      stack = await stackDetector.detectStack(cwd);
      detectedDevCommand = await stackDetector.detectDevCommand(stack, cwd);
      detectedPort = await stackDetector.detectPort(stack, cwd);
      const reStacks = [stack.framework, ...(stack.additionalStacks ?? [])].filter(s => s !== 'unknown').join(' + ') || 'unknown';
      spinner.succeed(`Detecting project... ${chalk.cyan(reStacks)} (${chalk.dim(stack.typescript ? 'TypeScript' : stack.language || 'unknown')})`);

      devCommand = config.project.devCommand || detectedDevCommand;
      devPort = config.project.port || detectedPort;

      if (!devCommand) {
        console.error(
          chalk.red('No dev command found after scaffolding. Set project.devCommand in nova.toml or ensure package.json has a "dev" script.'),
        );
        process.exit(1);
      }
    }
  }

  // ── 4. Initialize .nova/ and index project ────────────────────────
  spinner.start('Initializing .nova/ directory...');
  await novaDir.init(cwd);
  spinner.succeed('.nova/ directory ready.');

  spinner.start('Indexing project...');
  let projectMap: ProjectMap;
  try {
    projectMap = await indexer.index(cwd, { frontend: config.project.frontend, backends: config.project.backends });
  } catch (err) {
    spinner.fail('Failed to index project.');
    throw err;
  }
  spinner.succeed('Project indexed.');

  // ── 4b. Analyze project structure ─────────────────────────────────
  const { ProjectAnalyzer, RagIndexer, createEmbeddingService } = await import('@novastorm-ai/core');
  const { ProjectMapApi } = await import('@novastorm-ai/proxy');

  const projectAnalyzer = new ProjectAnalyzer();
  spinner.start('Analyzing project structure...');
  const analysis = await projectAnalyzer.analyze(cwd, projectMap);
  spinner.succeed(`Project analyzed: ${analysis.fileCount} files, ${analysis.methods.length} methods.`);

  // ── 4c. RAG indexing ──────────────────────────────────────────────
  let ragIndexer: InstanceType<typeof RagIndexer> | null = null;
  try {
    const { VectorStore } = await import('@novastorm-ai/core');

    let embeddingProvider: 'openai' | 'ollama' | 'tfidf' = 'tfidf';
    let embeddingApiKey: string | undefined;
    let embeddingBaseUrl: string | undefined;

    // 1. Try Ollama first (preferred — local, free, private)
    try {
      const res = await fetch('http://127.0.0.1:11434/api/tags');
      if (res.ok) {
        embeddingProvider = 'ollama';
        embeddingBaseUrl = 'http://127.0.0.1:11434';
      }
    } catch {
      // Ollama not running
    }

    // 2. Fall back to OpenAI if Ollama not available
    if (embeddingProvider === 'tfidf') {
      const openaiKey = config.apiKeys.provider === 'openai' ? config.apiKeys.key : process.env.OPENAI_API_KEY;
      if (openaiKey) {
        embeddingProvider = 'openai';
        embeddingApiKey = openaiKey;
      }
    }

    // 3. TF-IDF is the final fallback (always works)

    const embeddingService = createEmbeddingService({
      provider: embeddingProvider,
      apiKey: embeddingApiKey,
      baseUrl: embeddingBaseUrl,
    });
    const vectorStore = new VectorStore();
    ragIndexer = new RagIndexer(embeddingService, vectorStore);

    const providerLabel = embeddingProvider === 'openai' ? 'OpenAI' : embeddingProvider === 'ollama' ? 'Ollama' : 'TF-IDF (offline)';
    spinner.start(`Building RAG index (${providerLabel})...`);
    await ragIndexer.index(cwd, projectMap);
    spinner.succeed(`RAG index built: ${vectorStore.getRecordCount()} chunks (${providerLabel}).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.warn(`RAG indexing skipped: ${msg}`);
    ragIndexer = null;
  }

  // Set up project map API
  const projectMapApi = new ProjectMapApi();

  let proxyPort = devPort + PROXY_PORT_OFFSET;

  // ── 4b. Check ports ────────────────────────────────────────────────
  spinner.start('Checking ports...');
  const devPortBusy = await isPortInUse(devPort);
  const proxyPortBusy = await isPortInUse(proxyPort);

  if (devPortBusy || proxyPortBusy) {
    spinner.fail('Port conflict detected:');
    if (devPortBusy) {
      console.log(chalk.red(`  ✗ Port ${devPort} is already in use (dev server)`));
      console.log(chalk.gray(`    Kill the process: ${chalk.cyan(`lsof -ti :${devPort} | xargs kill`)}`));
    }
    if (proxyPortBusy) {
      console.log(chalk.red(`  ✗ Port ${proxyPort} is already in use (proxy)`));
      console.log(chalk.gray(`    Kill the process: ${chalk.cyan(`lsof -ti :${proxyPort} | xargs kill`)}`));
    }
    console.log(chalk.gray(`\n  Or change the port in nova.toml: ${chalk.cyan('port = <number>')}\n`));
    process.exit(1);
  }
  spinner.succeed('Ports available');

  // ── 4b. Check node_modules for Node.js projects ────────────────────
  const NODE_FRAMEWORKS = ['node', 'express', 'nest', 'fastify', 'koa', 'hapi', 'next.js', 'nuxt', 'sveltekit', 'astro', 'vite', 'cra'];
  if (NODE_FRAMEWORKS.includes(stack.framework) && !existsSync(join(cwd, 'node_modules'))) {
    const pm = stack.packageManager ?? 'npm';
    const installCmd = pm === 'yarn' ? 'yarn' : `${pm} install`;
    spinner.stop();
    console.log(chalk.dim(`  Installing dependencies (${installCmd})...`));
    try {
      const { execSync } = await import('node:child_process');
      execSync(installCmd, { cwd, stdio: 'pipe' });
      console.log(chalk.green('  Dependencies installed.'));
    } catch (installErr) {
      const stderr = (installErr as { stderr?: Buffer })?.stderr?.toString() ?? '';
      const errMsg = stderr || (installErr instanceof Error ? installErr.message : String(installErr));
      const errorLines = errMsg.split('\n').filter(l => /error/i.test(l)).slice(0, 5);
      console.log(chalk.red(`\n  Failed to install dependencies.`));
      if (errorLines.length) {
        console.log(chalk.dim(errorLines.map(l => `  ${l.trim()}`).join('\n')));
      }
      console.log();

      const choices: Array<{ name: string; value: string }> = [];

      if (/EJSONPARSE|JSON/.test(errMsg)) {
        console.log(chalk.yellow('  Cause: package.json contains invalid JSON.\n'));
        choices.push(
          { name: chalk.dim('Fix package.json automatically (remove syntax errors)'), value: 'fix-json' },
        );
      }
      if (/ENOENT|not found|Cannot find/.test(errMsg)) {
        console.log(chalk.yellow('  Cause: missing files or modules.\n'));
      }

      if (llmClient) {
        choices.push(
          { name: chalk.dim('Describe what to fix (AI will handle it)'), value: 'ai-fix' },
        );
      }
      choices.push(
        { name: chalk.dim('Skip install and continue'), value: 'skip' },
        { name: chalk.dim('Exit'), value: 'exit' },
      );

      let resolved = false;
      while (!resolved) {
        let action: string;
        try {
          action = await select({ message: 'What would you like to do?', choices, theme: SELECT_THEME });
        } catch {
          process.exit(0);
        }

        if (action === 'fix-json') {
          try {
            const pkgPath = join(cwd, 'package.json');
            let content = readFileSync(pkgPath, 'utf-8');

            // Step 1: Try regex fixes (trailing commas, missing commas)
            content = content.replace(/,(\s*[}\]])/g, '$1');
            content = content.replace(/"(\s*\n\s*")/g, '",\n  "');
            writeFileSync(pkgPath, content, 'utf-8');

            // Step 2: Validate JSON — if still broken, use AI
            try {
              JSON.parse(readFileSync(pkgPath, 'utf-8'));
            } catch {
              if (llmClient) {
                console.log(chalk.dim('  Regex fix insufficient, asking AI to fix package.json...\n'));
                const brokenContent = readFileSync(pkgPath, 'utf-8');
                const response = await llmClient.chat([
                  { role: 'system', content: 'You are a JSON fixer. You receive a broken package.json. Output ONLY the corrected valid JSON. No explanation, no markdown fences, just the JSON.' },
                  { role: 'user', content: `Fix this package.json:\n\n${brokenContent}` },
                ], { temperature: 0, maxTokens: 4096 });

                // Extract JSON from response (strip markdown fences if present)
                let fixed = response.trim();
                const fenceMatch = fixed.match(/```(?:json)?\n([\s\S]*?)```/);
                if (fenceMatch) fixed = fenceMatch[1].trim();

                // Validate before writing
                JSON.parse(fixed);
                writeFileSync(pkgPath, fixed, 'utf-8');
                console.log(chalk.green('  AI fixed package.json.'));
              }
            }

            console.log(chalk.dim('  Retrying install...\n'));
            const { execSync } = await import('node:child_process');
            execSync(installCmd, { cwd, stdio: 'pipe' });
            console.log(chalk.green('  Dependencies installed.'));
            resolved = true;
          } catch (fixErr) {
            console.log(chalk.red(`  Fix failed: ${fixErr instanceof Error ? fixErr.message : fixErr}\n`));
          }
        } else if (action === 'ai-fix') {
          try {
            const userDesc = await input({ message: 'Describe what needs to be fixed:' });
            if (userDesc.trim() && llmClient) {
              console.log(chalk.dim('\n  AI is working on it...\n'));
              const response = await llmClient.chat([
                { role: 'system', content: `You are a code fixer. You receive an error and a user description of what to fix. Output ONLY the fixed file content with no explanation. Format:\n=== FILE: path/to/file ===\nfull file content\n=== END FILE ===` },
                { role: 'user', content: `Error:\n${errMsg.slice(0, 800)}\n\nUser says: ${userDesc.trim()}\n\nProject directory: ${cwd}\nFix the issue. Output the corrected file(s).` },
              ], { temperature: 0, maxTokens: 4096 });

              // Parse and write file blocks
              const fileBlockRegex = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g;
              let match;
              let filesWritten = 0;
              while ((match = fileBlockRegex.exec(response)) !== null) {
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
                resolved = true;
              } else {
                console.log(chalk.red('  AI could not produce a fix.\n'));
              }
            }
          } catch (aiErr) {
            console.log(chalk.red(`  Failed: ${aiErr instanceof Error ? aiErr.message : aiErr}\n`));
          }
        } else if (action === 'skip') {
          console.log(chalk.dim('  Skipping install.'));
          resolved = true;
        } else {
          process.exit(0);
        }
      }
    }
  }

  // ── 5. Start dev server ─────────────────────────────────────────────
  spinner.start(`Starting dev server (${chalk.dim(devCommand)})...`);

  try {
    await devServer.spawn(devCommand, cwd, devPort);
  } catch (err) {
    spinner.fail('Dev server failed to start.');
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n${msg}`));

    const choices: Array<{ name: string; value: string }> = [];

    if (/EADDRINUSE|address already in use/i.test(msg)) {
      console.log(chalk.yellow(`\n  Port ${devPort} is already in use.\n`));
      choices.push(
        { name: chalk.dim(`Kill process on port ${devPort} and retry`), value: 'kill-retry' },
        { name: chalk.dim('Use a different port'), value: 'change-port' },
      );
    }
    if (/Cannot find module|MODULE_NOT_FOUND/i.test(msg)) {
      console.log(chalk.yellow('\n  Missing dependencies.\n'));
      choices.push(
        { name: chalk.dim('Run npm install and retry'), value: 'install-retry' },
      );
    }
    if (/EJSONPARSE|JSON/.test(msg)) {
      console.log(chalk.yellow('\n  package.json has invalid JSON.\n'));
      choices.push(
        { name: chalk.dim('Fix package.json and retry'), value: 'fix-json-retry' },
      );
    }

    if (llmClient) {
      choices.push(
        { name: chalk.dim('Describe what to fix (AI will handle it)'), value: 'ai-fix' },
      );
    }
    choices.push(
      { name: chalk.dim('Exit'), value: 'exit' },
    );

    let serverResolved = false;
    while (!serverResolved) {
      let action: string;
      try {
        action = await select({ message: 'What would you like to do?', choices, theme: SELECT_THEME });
      } catch {
        process.exit(0);
      }

      if (action === 'kill-retry') {
        try {
          const { execSync } = await import('node:child_process');
          execSync(`lsof -ti :${devPort} | xargs kill -9`, { stdio: 'ignore' });
          console.log(chalk.dim(`  Killed process on port ${devPort}. Retrying...\n`));
          await devServer.spawn(devCommand, cwd, devPort);
          serverResolved = true;
        } catch (retryErr) {
          console.log(chalk.red(`  Still failing: ${retryErr instanceof Error ? retryErr.message : retryErr}\n`));
        }
      } else if (action === 'change-port') {
        try {
          const newPortStr = await input({ message: 'Enter port number:', default: String(devPort + 10) });
          devPort = parseInt(newPortStr, 10);
          proxyPort = devPort + PROXY_PORT_OFFSET;
          console.log(chalk.dim(`  Trying port ${devPort}...\n`));
          await devServer.spawn(devCommand, cwd, devPort);
          serverResolved = true;
        } catch (retryErr) {
          console.log(chalk.red(`  Failed: ${retryErr instanceof Error ? retryErr.message : retryErr}\n`));
        }
      } else if (action === 'install-retry') {
        try {
          const pm = stack.packageManager ?? 'npm';
          const cmd = pm === 'yarn' ? 'yarn' : `${pm} install`;
          const { execSync } = await import('node:child_process');
          execSync(cmd, { cwd, stdio: 'inherit' });
          console.log(chalk.green('  Dependencies installed. Retrying dev server...\n'));
          await devServer.spawn(devCommand, cwd, devPort);
          serverResolved = true;
        } catch (retryErr) {
          console.log(chalk.red(`  Still failing: ${retryErr instanceof Error ? retryErr.message : retryErr}\n`));
        }
      } else if (action === 'fix-json-retry') {
        try {
          const pkgPath = join(cwd, 'package.json');
          let content = readFileSync(pkgPath, 'utf-8');
          content = content.replace(/,(\s*[}\]])/g, '$1');
          content = content.replace(/"(\s*\n\s*")/g, '",\n  "');
          writeFileSync(pkgPath, content, 'utf-8');

          try {
            JSON.parse(readFileSync(pkgPath, 'utf-8'));
          } catch {
            if (llmClient) {
              console.log(chalk.dim('  Regex fix insufficient, asking AI to fix package.json...\n'));
              const brokenContent = readFileSync(pkgPath, 'utf-8');
              const resp = await llmClient.chat([
                { role: 'system', content: 'You are a JSON fixer. You receive a broken package.json. Output ONLY the corrected valid JSON. No explanation, no markdown fences, just the JSON.' },
                { role: 'user', content: `Fix this package.json:\n\n${brokenContent}` },
              ], { temperature: 0, maxTokens: 4096 });
              let fixed = resp.trim();
              const fence = fixed.match(/```(?:json)?\n([\s\S]*?)```/);
              if (fence) fixed = fence[1].trim();
              JSON.parse(fixed);
              writeFileSync(pkgPath, fixed, 'utf-8');
              console.log(chalk.green('  AI fixed package.json.'));
            }
          }

          console.log(chalk.dim('  Retrying...\n'));
          const pm = stack.packageManager ?? 'npm';
          const cmd = pm === 'yarn' ? 'yarn' : `${pm} install`;
          const { execSync } = await import('node:child_process');
          execSync(cmd, { cwd, stdio: 'pipe' });
          await devServer.spawn(devCommand, cwd, devPort);
          serverResolved = true;
        } catch (retryErr) {
          console.log(chalk.red(`  Failed: ${retryErr instanceof Error ? retryErr.message : retryErr}\n`));
        }
      } else if (action === 'ai-fix') {
        try {
          const userDesc = await input({ message: 'Describe what needs to be fixed:' });
          if (userDesc.trim() && llmClient) {
            console.log(chalk.dim('\n  AI is working on it...\n'));
            const response = await llmClient.chat([
              { role: 'system', content: `You are a code fixer. You receive an error and a user description of what to fix. Output ONLY the fixed file content with no explanation. Format:\n=== FILE: path/to/file ===\nfull file content\n=== END FILE ===` },
              { role: 'user', content: `Error:\n${msg.slice(0, 800)}\n\nUser says: ${userDesc.trim()}\n\nProject directory: ${cwd}\nFix the issue. Output the corrected file(s).` },
            ], { temperature: 0, maxTokens: 4096 });

            const fileBlockRegex = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g;
            let fMatch;
            let filesWritten = 0;
            while ((fMatch = fileBlockRegex.exec(response)) !== null) {
              const filePath = join(cwd, fMatch[1].trim());
              const { mkdirSync, writeFileSync: writeSync } = await import('node:fs');
              const { dirname } = await import('node:path');
              mkdirSync(dirname(filePath), { recursive: true });
              writeSync(filePath, fMatch[2], 'utf-8');
              console.log(chalk.dim(`  Wrote: ${fMatch[1].trim()}`));
              filesWritten++;
            }

            if (filesWritten > 0) {
              console.log(chalk.green(`\n  AI fixed ${filesWritten} file(s). Retrying dev server...\n`));
              await devServer.spawn(devCommand, cwd, devPort);
              serverResolved = true;
            } else {
              console.log(chalk.red('  AI could not produce a fix.\n'));
            }
          }
        } catch (retryErr) {
          console.log(chalk.red(`  Failed: ${retryErr instanceof Error ? retryErr.message : retryErr}\n`));
        }
      } else {
        process.exit(0);
      }
    }
  }

  // Check if dev server started on a different port
  const actualPort = devServer.getActualPort();
  if (actualPort && actualPort !== devPort) {
    spinner.succeed(`Dev server started on port ${chalk.yellow(actualPort)} (requested ${devPort})`);
    devPort = actualPort;
    proxyPort = devPort + PROXY_PORT_OFFSET;
  } else {
    spinner.succeed('Dev server started');
  }

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

  // ── 6c. Wire project map API to proxy ─────────────────────────────
  proxyServer.setProjectMapApi(projectMapApi);
  const { GraphStore: GS, SearchRouter: SR } = await import('@novastorm-ai/core');
  const novaPath = novaDir.getPath(cwd);
  const graphStoreForApi = new GS(novaPath);
  const searchRouterForApi = new SR(graphStoreForApi);
  projectMapApi.setGraphStore(graphStoreForApi);
  projectMapApi.setSearchRouter(searchRouterForApi);
  projectMapApi.setAnalysis(analysis);

  // Send analysis_complete event to overlay
  setTimeout(() => {
    wsServer.sendEvent({
      type: 'analysis_complete',
      data: { fileCount: analysis.fileCount, methodCount: analysis.methods.length },
    } as NovaEvent);
  }, 2000);

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
  // Set up executors for task execution
  // Ensure git repo exists for commits
  try {
    const { execSync } = await import('node:child_process');
    execSync('git rev-parse --git-dir', { cwd, stdio: 'ignore' });
  } catch {
    // Not a git repo — initialize one
    const { execSync } = await import('node:child_process');
    execSync('git init', { cwd, stdio: 'ignore' });
    execSync('git add -A && git commit -m "Initial commit (before Nova)" --allow-empty', { cwd, stdio: 'ignore', shell: '/bin/sh' });
    console.log(chalk.dim('Initialized git repository.'));
  }

  // Create a nova branch for changes
  const gitManager = new GitManager(cwd);
  try {
    const branch = await gitManager.createBranch(config.behavior.branchPrefix);
    console.log(chalk.dim(`Working on branch: ${branch}`));
  } catch {
    // May already be on a nova branch, that's ok
  }
  let executorPool: ExecutorPool | null = null;
  const commitQueue = new CommitQueue(gitManager);
  if (llmClient) {
    const pathGuard = new PathGuard(cwd);
    if (config.project.frontend) pathGuard.allow(resolve(cwd, config.project.frontend));
    for (const b of config.project.backends ?? []) pathGuard.allow(resolve(cwd, b));

    // Load manifest boundaries into PathGuard
    const manifestStore = new ManifestStore();
    const manifest = await manifestStore.load(cwd);
    if (manifest?.boundaries) {
      pathGuard.loadBoundaries(manifest.boundaries);
    }

    const agentPromptLoader = new AgentPromptLoader();
    const lane1 = new Lane1Executor(cwd, pathGuard);
    const lane2 = new Lane2Executor(cwd, llmClient, gitManager, pathGuard, commitQueue);
    executorPool = new ExecutorPool(lane1, lane2, eventBus, llmClient, gitManager, cwd, config.models.micro, config.models.standard, config.models.strong, agentPromptLoader, pathGuard, undefined, commitQueue);
  }

  // Wire dev server output to auto-fixer for error detection
  let autoFixer: ErrorAutoFixer | null = null;
  if (llmClient) {
    autoFixer = new ErrorAutoFixer(cwd, llmClient, gitManager, eventBus, wsServer, projectMap, commitQueue, config.models.micro);
  }
  devServer.onOutput((output: string) => {
    autoFixer?.handleOutput(output);
  });

  // Wire secrets submission from overlay
  const envDetector = new EnvDetector();
  wsServer.onSecretsSubmit((secrets: Record<string, string>) => {
    console.log(chalk.cyan(`[Nova] Saving ${Object.keys(secrets).length} secret(s) to .env.local`));
    envDetector.writeEnvLocal(cwd, secrets);
    envDetector.ensureGitignored(cwd);
    wsServer.sendEvent({ type: 'status', data: { message: `Saved ${Object.keys(secrets).length} secret(s) to .env.local` } } as NovaEvent);
  });

  // Wire browser errors from overlay to autoFixer
  wsServer.onBrowserError((error: string) => {
    console.log(chalk.yellow(`[Nova] Browser error: ${error.slice(0, 150)}`));
    autoFixer?.handleOutput(error);
  });

  // Wire WebSocket observations into EventBus
  wsServer.onObservation((observation: Observation, _autoExecute?: boolean) => {
    logger.logObservation(observation);
    eventBus.emit({ type: 'observation', data: observation });
  });

  // Handle observations: analyze and create tasks (pending confirmation)
  eventBus.on('observation', async (event) => {
    if (!brain) {
      console.log(chalk.yellow('Observation received but no AI configured. Run "nova setup" to add an API key.'));
      return;
    }
    try {
      lastObservation = event.data;
      const transcript = event.data.transcript ?? 'click';

      // Detect revert/undo commands — handle directly via git
      if (/\b(revert|верни|откати|undo|отмени последн|верни назад|откатить)\b/i.test(transcript)) {
        console.log(chalk.cyan('[Nova] Detected revert request — using git revert'));
        wsServer.sendEvent({ type: 'status', data: { message: 'Reverting last commit...' } } as NovaEvent);
        try {
          const log = await gitManager.getLog();
          if (log.length > 0) {
            const lastCommit = log[0];
            console.log(chalk.cyan(`[Nova] Reverting commit: ${lastCommit.hash} — ${lastCommit.message}`));
            await gitManager.rollback(lastCommit.hash);
            console.log(chalk.green(`[Nova] Reverted successfully!`));
            wsServer.sendEvent({ type: 'status', data: { message: `Reverted: ${lastCommit.message.slice(0, 80)}` } } as NovaEvent);
            // Reload overlay
            setTimeout(() => {
              wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } } as NovaEvent);
            }, 1500);
          } else {
            console.log(chalk.yellow('[Nova] No commits to revert'));
            wsServer.sendEvent({ type: 'status', data: { message: 'No commits to revert.' } } as NovaEvent);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(chalk.red(`[Nova] Revert failed: ${msg}`));
          wsServer.sendEvent({ type: 'status', data: { message: `Revert failed: ${msg}` } } as NovaEvent);
        }
        return;
      }

      logger.logAnalyzing(transcript);
      wsServer.sendEvent({ type: 'status', data: { message: `🧠 AI is thinking about: "${transcript.slice(0, 80)}"...` } } as NovaEvent);

      const analyzeSpinner = ora({ text: chalk.yellow('AI is thinking...'), spinner: 'dots' }).start();

      const tasks = await brain.analyze(event.data, projectMap);
      analyzeSpinner.succeed(chalk.green(`AI produced ${tasks.length} task(s)`));
      logger.logTasks(tasks);

      if (tasks.length === 0) {
        // Brain may have asked a clarifying question (sent via status "question:..." event)
        // Don't overwrite it with "No tasks generated"
        console.log(chalk.dim('[Nova] No tasks produced — AI may have asked a question'));
        return;
      }

      wsServer.sendEvent({ type: 'status', data: { message: `AI produced ${tasks.length} task(s)` } } as NovaEvent);

      // Auto-execute tasks immediately (no confirmation needed)
      console.log(chalk.green(`Auto-executing ${tasks.length} task(s)...`));
      wsServer.sendEvent({ type: 'status', data: { message: `Auto-executing ${tasks.length} task(s)...` } } as NovaEvent);
      wsServer.sendEvent({ type: 'status', data: { message: 'Confirmed! Executing tasks...' } } as NovaEvent);
      executeTasks(tasks);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Analysis error: ${message}`));
      wsServer.sendEvent({ type: 'status', data: { message: `Analysis error: ${message}` } } as NovaEvent);
    }
  });

  // Handle confirm/cancel from overlay
  wsServer.onConfirm(() => {
    if (pendingTasks.length === 0) {
      console.log(chalk.dim('No pending tasks to confirm.'));
      return;
    }
    console.log(chalk.green(`Confirmed ${pendingTasks.length} task(s). Executing...`));
    wsServer.sendEvent({ type: 'status', data: { message: 'Confirmed! Executing tasks...' } } as NovaEvent);
    const tasksToRun = [...pendingTasks];
    pendingTasks = [];
    executeTasks(tasksToRun);
  });

  wsServer.onCancel(() => {
    if (pendingTasks.length === 0) {
      console.log(chalk.dim('No pending tasks to cancel.'));
      return;
    }
    console.log(chalk.yellow(`Cancelled ${pendingTasks.length} task(s).`));
    wsServer.sendEvent({ type: 'status', data: { message: 'Tasks cancelled.' } } as NovaEvent);
    pendingTasks = [];
  });

  // Handle append — user adds details to the pending request, re-analyze
  wsServer.onAppend(async (text: string) => {
    if (!brain || !lastObservation) return;

    console.log(chalk.cyan(`[Nova] Appending to request: "${text}"`));

    // Merge the new text with the original transcript
    const originalTranscript = lastObservation.transcript ?? '';
    const mergedTranscript = `${originalTranscript}. Additionally: ${text}`;

    const updatedObservation: Observation = {
      ...lastObservation,
      transcript: mergedTranscript,
    };

    // Clear pending, re-analyze
    pendingTasks = [];
    wsServer.sendEvent({ type: 'status', data: { message: `Re-analyzing with: "${text}"...` } } as NovaEvent);

    try {
      logger.logAnalyzing(mergedTranscript);
      const tasks = await brain.analyze(updatedObservation, projectMap);
      logger.logTasks(tasks);

      if (tasks.length === 0) {
        wsServer.sendEvent({ type: 'status', data: { message: 'No tasks generated.' } } as NovaEvent);
        return;
      }

      pendingTasks = tasks;
      const taskDescriptions = tasks.map((t, i) => `${i + 1}. ${t.description}`).join('; ');
      const pendingMessage = `Pending: ${tasks.length} task(s) — ${taskDescriptions}. Say "yes"/"execute" to proceed or "no"/"cancel" to discard.`;
      console.log(chalk.yellow(`\n${pendingMessage}\n`));
      wsServer.sendEvent({ type: 'status', data: { message: pendingMessage, tasks: tasks.map(t => ({ id: t.id, description: t.description, lane: t.lane })) } } as NovaEvent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Analysis error: ${message}`));
      wsServer.sendEvent({ type: 'status', data: { message: `Analysis error: ${message}` } } as NovaEvent);
    }
  });

  // Execute a batch of tasks in parallel with concurrency limit
  function executeTasks(tasks: TaskItem[]): void {
    // Emit task_created events for UI/logging
    for (const task of tasks) {
      eventBus.emit({ type: 'task_created', data: task });
    }

    if (!executorPool) return;

    const pool = executorPool;
    const taskFns = tasks.map((task) => async () => {
      try {
        return await pool.execute(task, projectMap);
      } catch {
        // Error already emitted by executor pool
        return { success: false, taskId: task.id, error: 'Execution failed' } as ExecutionResult;
      }
    });

    runWithConcurrency(taskFns, MAX_TASK_CONCURRENCY).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Task batch error: ${message}`));
    });
  }

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

    // After task completes, check site health (wait for hot reload)
    setTimeout(async () => {
      // Skip post-task check for auto-fix tasks (prevents cascading fixes)
      if (autoFixer?.isAutofixTask(event.data.taskId)) return;

      // Check dev server logs for errors
      const logs = devServer.getLogs();
      const recentLogs = logs.slice(-2000);
      const hasLogError = /error|Error|failed|Failed|Module not found|SyntaxError|TypeError/i.test(recentLogs)
        && !/Successfully compiled|Compiled/.test(recentLogs.slice(-500));

      if (hasLogError && autoFixer) {
        const errorLines = recentLogs.split('\n').filter(l => /error|Error|failed|Module not found/i.test(l)).slice(-5).join('\n');
        if (errorLines.trim()) {
          console.log(chalk.yellow(`[Nova] Post-task health check: build errors detected, auto-fixing...`));
          wsServer.sendEvent({ type: 'status', data: { message: 'Post-task check: fixing build errors...' } } as NovaEvent);
          autoFixer.forceFixNow(errorLines);
          return;
        }
      }

      // Also HTTP health check
      try {
        const http = await import('node:http');
        const res = await new Promise<{ statusCode?: number }>((resolve) => {
          const req = http.get(`http://127.0.0.1:${devPort}`, resolve);
          req.on('error', () => resolve({ statusCode: 0 }));
          req.setTimeout(5000, () => { req.destroy(); resolve({ statusCode: 0 }); });
        });
        if (res.statusCode && res.statusCode >= 500) {
          console.log(chalk.yellow(`[Nova] Post-task health check: HTTP ${res.statusCode}, auto-fixing...`));
          wsServer.sendEvent({ type: 'status', data: { message: `Site returned ${res.statusCode}, auto-fixing...` } } as NovaEvent);
          autoFixer?.forceFixNow(`Dev server returned HTTP ${res.statusCode} after code changes`);
        }
      } catch {
        // Health check failed silently
      }
    }, 1500);
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

  eventBus.on('llm_chunk', (event) => {
    wsServer.sendEvent(event as NovaEvent);
  });

  // Forward secrets_required events to overlay
  eventBus.on('secrets_required', (event) => {
    wsServer.sendEvent(event as NovaEvent);
  });

  // Forward all status events from Brain/Executor to overlay
  eventBus.on('status', (event) => {
    wsServer.sendEvent(event as NovaEvent);
  });

  console.log(
    chalk.bold.green('\nReady! Click elements or speak to start building.'),
  );
  console.log(chalk.dim('Type commands below, or use /help for available commands.\n'));

  // ── Startup health check (after overlay is ready) ─────────────────
  // Delayed so overlay WebSocket has time to connect
  setTimeout(async () => {
    const startupLogs = devServer.getLogs();
    const startupErrors = startupLogs.split('\n')
      .filter(l => /error|Error|failed|Module not found|SyntaxError|Cannot find/i.test(l))
      .filter(l => !/warning|warn|deprecat|DeprecationWarning/i.test(l))
      .slice(-10)
      .join('\n')
      .trim();

    if (!startupErrors || !llmClient) return;

    console.log(chalk.red('\n[Nova] Build errors detected at startup:'));
    console.log(chalk.dim(startupErrors.slice(0, 500)));

    // Create fix task and put it in pendingTasks — uses same confirm flow as regular tasks
    const fixTask: TaskItem = {
      id: crypto.randomUUID(),
      description: `Fix build errors at startup:\n${startupErrors.slice(0, 500)}`,
      files: [],
      type: 'multi_file',
      lane: 3,
      status: 'pending',
    };

    pendingTasks = [fixTask];

    const pendingMessage = `Pending: Build errors detected at startup. Fix them? 1. ${fixTask.description.slice(0, 100)}`;
    console.log(chalk.yellow(`\n${pendingMessage}`));
    console.log(chalk.dim('Press Y/Enter to fix, N to skip'));
    wsServer.sendEvent({
      type: 'status',
      data: {
        message: pendingMessage,
        tasks: [{ id: fixTask.id, description: 'Fix startup build errors', lane: 3 }],
      },
    } as NovaEvent);
  }, 4000);

  // ── 9. Handle Ctrl+C ───────────────────────────────────────────────
  let shuttingDown = false;
  let chat: NovaChat | null = null;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(chalk.dim('\n\nShutting down Nova...'));

    chat?.stop();

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

  // Suppress dev server error on intentional shutdown; forward to overlay
  devServer.onError((error) => {
    if (!shuttingDown) {
      console.error(chalk.red(`\nDev server error: ${error}`));
      wsServer.sendEvent({ type: 'status', data: { message: `Dev server error: ${error}` } } as NovaEvent);
    }
  });

  // ── 9b. Terminal chat ───────────────────────────────────────────────
  chat = new NovaChat();

  chat.onCommand(async (cmd) => {
    switch (cmd.type) {
      case 'text': {
        // Create a synthetic observation from terminal text
        if (!brain) {
          chat!.log(chalk.yellow('AI not configured. Run /settings apiKeys.provider <provider> to set up.'));
          return;
        }

        const observation: Observation = {
          screenshot: Buffer.alloc(0),
          transcript: cmd.args,
          currentUrl: `file://${cwd}`,
          timestamp: Date.now(),
        };

        lastObservation = observation;
        logger.logObservation(observation);
        eventBus.emit({ type: 'observation', data: observation });
        break;
      }

      case 'confirm': {
        if (pendingTasks.length === 0) {
          chat!.log(chalk.dim('No pending tasks to confirm.'));
          return;
        }
        chat!.log(chalk.green(`Confirmed ${pendingTasks.length} task(s). Executing...`));
        wsServer.sendEvent({ type: 'status', data: { message: 'Confirmed! Executing tasks...' } } as NovaEvent);
        for (const task of pendingTasks) {
          eventBus.emit({ type: 'task_created', data: task });
        }
        pendingTasks = [];
        break;
      }

      case 'cancel': {
        if (pendingTasks.length === 0) {
          chat!.log(chalk.dim('No pending tasks to cancel.'));
          return;
        }
        chat!.log(chalk.yellow(`Cancelled ${pendingTasks.length} task(s).`));
        wsServer.sendEvent({ type: 'status', data: { message: 'Tasks cancelled.' } } as NovaEvent);
        pendingTasks = [];
        break;
      }

      case 'settings': {
        const result = await handleSettingsCommand(cmd.args, config, configReader, cwd);
        chat!.log(result);
        break;
      }

      case 'help': {
        chat!.log([
          chalk.bold('\nNova Commands\n'),
          `  ${chalk.cyan('any text')}        Send as a code change request (like voice in UI)`,
          `  ${chalk.cyan('/settings')}       View all settings`,
          `  ${chalk.cyan('/settings k v')}   Change a setting`,
          `  ${chalk.cyan('/status')}         Show current status`,
          `  ${chalk.cyan('/map')}            Open project map in browser`,
          `  ${chalk.cyan('/help')}           Show this help`,
          `  ${chalk.cyan('y / yes')}         Confirm pending tasks`,
          `  ${chalk.cyan('n / no')}          Cancel pending tasks`,
          `  ${chalk.cyan('Ctrl+C')}          Shutdown Nova`,
          '',
        ].join('\n'));
        break;
      }

      case 'status': {
        const parts: string[] = [chalk.bold('\nNova Status\n')];
        parts.push(`  ${chalk.dim('Project:')} ${cwd}`);
        parts.push(`  ${chalk.dim('Stack:')} ${projectMap.stack.framework} (${projectMap.stack.language})`);
        parts.push(`  ${chalk.dim('Dev server:')} localhost:${devPort}`);
        parts.push(`  ${chalk.dim('Proxy:')} localhost:${proxyPort}`);
        parts.push(`  ${chalk.dim('Overlay clients:')} ${wsServer.getClientCount()}`);
        parts.push(`  ${chalk.dim('AI:')} ${llmClient ? `${config.apiKeys.provider}` : 'not configured'}`);
        parts.push(`  ${chalk.dim('RAG:')} ${ragIndexer ? 'active' : 'disabled'}`);
        parts.push(`  ${chalk.dim('Pending tasks:')} ${pendingTasks.length}`);
        parts.push('');
        chat!.log(parts.join('\n'));
        break;
      }

      case 'map': {
        const url = `http://127.0.0.1:${proxyPort}/nova-project-map`;
        chat!.log(chalk.cyan(`Opening project map: ${url}`));
        const { exec: execCmd } = await import('node:child_process');
        if (process.platform === 'darwin') {
          execCmd(`open "${url}"`);
        } else if (process.platform === 'win32') {
          execCmd(`start "${url}"`);
        } else {
          execCmd(`xdg-open "${url}"`);
        }
        break;
      }
    }
  });

  chat.start();

  // Disable early exit handler, use proper shutdown from now on
  earlyExit = false;

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
