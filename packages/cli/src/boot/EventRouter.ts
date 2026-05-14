import chalk from 'chalk';
import ora from 'ora';
import {
  type NovaEventBus,
  type Brain,
  type GitManager,
  type ProjectMap,
  type Observation,
  type TaskItem,
  type NovaConfig,
  EnvDetector,
} from '@novastorm-ai/core';
import type { WebSocketServer, DevServerRunner } from '@novastorm-ai/proxy';
import type { ErrorAutoFixer } from '../autofix.js';
import type { NovaLogger } from '../logger.js';
import type { StartOptions } from '../index.js';
import { isNonInteractive } from './utils.js';

const MAX_TASK_CONCURRENCY = 3;

export interface EventRouterDeps {
  wsServer: WebSocketServer;
  eventBus: NovaEventBus;
  brain: Brain | null;
  config: NovaConfig;
  options: StartOptions;
  gitManager: GitManager;
  executorPool: { execute: (task: TaskItem, map: ProjectMap) => Promise<unknown> } | null;
  autoFixer: ErrorAutoFixer | null;
  devServer: DevServerRunner;
  logger: NovaLogger;
  projectMap: ProjectMap;
  taskMap: Map<string, TaskItem>;
  pendingTasks: TaskItem[];
  lastObservation: { current: Observation | null };
}

/**
 * EventRouter bridges WebSocket observations into the Brain/Executor
 * pipeline and forwards executor events back to the overlay.
 *
 * Call `setupEventRouting()` once during boot — it registers all the
 * event handlers that form the core Nova interaction loop.
 */
export function setupEventRouting(deps: EventRouterDeps): void {
  const {
    wsServer,
    eventBus,
    brain,
    config,
    options,
    gitManager,
    executorPool,
    autoFixer,
    devServer,
    logger,
    projectMap,
    taskMap,
  } = deps;

  // ── Execute a batch of tasks in parallel ──────────────────────────
  function executeTasks(tasks: TaskItem[]): void {
    for (const task of tasks) {
      eventBus.emit({ type: 'task_created', data: task });
    }

    if (!executorPool) return;

    const pool = executorPool;
    const taskFns = tasks.map((task) => async () => {
      try {
        return await pool.execute(task, projectMap);
      } catch {
        return { success: false, taskId: task.id, error: 'Execution failed' };
      }
    });

    runWithConcurrency(taskFns, MAX_TASK_CONCURRENCY).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Task batch error: ${message}`));
    });
  }

  // ── Wire WS observations into EventBus ────────────────────────────
  wsServer.onObservation((observation: Observation, autoExecute?: boolean) => {
    logger.logObservation(observation);
    eventBus.emit({ type: 'observation', data: { ...observation, autoExecute } } as any);
  });

  // ── Handle observations: analyze → create tasks ───────────────────
  eventBus.on('observation', async (event) => {
    if (!brain) {
      console.log(
        chalk.yellow(
          'Observation received but no AI configured. Run "nova setup" to add an API key.',
        ),
      );
      return;
    }

    try {
      deps.lastObservation.current = event.data;

      const transcript = event.data.transcript ?? 'click';

      // Detect revert/undo commands
      if (/\b(revert|верни|откати|undo|отмени последн|верни назад|откатить)\b/i.test(transcript)) {
        console.log(chalk.cyan('[Nova] Detected revert request — using git revert'));
        wsServer.sendEvent({
          type: 'status',
          data: { message: 'Reverting last commit...' },
        });
        try {
          const log = await gitManager.getLog();
          if (log.length > 0) {
            const lastCommit = log[0];
            console.log(
              chalk.cyan(`[Nova] Reverting commit: ${lastCommit.hash} — ${lastCommit.message}`),
            );
            await gitManager.rollback(lastCommit.hash);
            console.log(chalk.green(`[Nova] Reverted successfully!`));
            wsServer.sendEvent({
              type: 'status',
              data: { message: `Reverted: ${lastCommit.message.slice(0, 80)}` },
            });
            setTimeout(() => {
              wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } });
            }, 1500);
          } else {
            console.log(chalk.yellow('[Nova] No commits to revert'));
            wsServer.sendEvent({
              type: 'status',
              data: { message: 'No commits to revert.' },
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(chalk.red(`[Nova] Revert failed: ${msg}`));
          wsServer.sendEvent({
            type: 'status',
            data: { message: `Revert failed: ${msg}` },
          });
        }
        return;
      }

      logger.logAnalyzing(transcript);
      wsServer.sendEvent({
        type: 'status',
        data: { message: `🧠 AI is thinking about: "${transcript.slice(0, 80)}"...` },
      });

      const analyzeSpinner = ora({
        text: chalk.yellow('AI is thinking...'),
        spinner: 'dots',
      }).start();

      const tasks = await brain.analyze(event.data, projectMap);
      analyzeSpinner.succeed(chalk.green(`AI produced ${tasks.length} task(s)`));
      logger.logTasks(tasks);

      if (tasks.length === 0) {
        console.log(chalk.dim('[Nova] No tasks produced — AI may have asked a question'));
        return;
      }

      const isPreConfirmed = (event.data as any).autoExecute === true;

      if (isPreConfirmed) {
        for (const task of tasks) {
          task.preConfirmed = true;
        }
      }

      const shouldAutoExecute =
        isNonInteractive(options) ||
        config.behavior.confirmTasks === false ||
        isPreConfirmed;

      if (shouldAutoExecute) {
        console.log(chalk.green(`Executing ${tasks.length} task(s)...`));
        wsServer.sendEvent({
          type: 'status',
          data: { message: `Executing ${tasks.length} task(s)...` },
        });
        executeTasks(tasks);
      } else {
        deps.pendingTasks.length = 0;
        deps.pendingTasks.push(...tasks);
        const taskDescriptions = tasks.map((t, i) => `${i + 1}. ${t.description}`).join('; ');
        const pendingMessage = `Press Y to execute, N to discard — ${taskDescriptions}`;
        console.log(chalk.yellow(`\n${pendingMessage}\n`));
        wsServer.sendEvent({
          type: 'pending_tasks',
          data: {
            tasks: tasks.map((t) => ({
              id: t.id,
              description: t.description,
              lane: t.lane,
              preConfirmed: t.preConfirmed,
            })),
            message: pendingMessage,
          },
        });
        wsServer.sendEvent({
          type: 'status',
          data: { message: 'Awaiting confirmation' },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Analysis error: ${message}`));
      wsServer.sendEvent({
        type: 'status',
        data: { message: `Analysis error: ${message}` },
      });
    }
  });

  // ── Confirmation handlers ─────────────────────────────────────────
  wsServer.onConfirm(() => {
    if (deps.pendingTasks.length === 0) return;
    console.log(chalk.green(`Confirmed ${deps.pendingTasks.length} task(s). Executing...`));
    wsServer.sendEvent({
      type: 'status',
      data: { message: `Executing ${deps.pendingTasks.length} task(s)...` },
    });
    const tasksToRun = [...deps.pendingTasks];
    deps.pendingTasks.length = 0;
    executeTasks(tasksToRun);
  });

  wsServer.onConfirmTasks(() => {
    if (deps.pendingTasks.length === 0) return;
    console.log(
      chalk.green(`Confirmed ${deps.pendingTasks.length} task(s) via overlay. Executing...`),
    );
    wsServer.sendEvent({
      type: 'status',
      data: { message: `Executing ${deps.pendingTasks.length} task(s)...` },
    });
    const tasksToRun = [...deps.pendingTasks];
    deps.pendingTasks.length = 0;
    executeTasks(tasksToRun);
  });

  wsServer.onCancel(() => {
    if (deps.pendingTasks.length === 0) return;
    console.log(chalk.yellow(`Cancelled ${deps.pendingTasks.length} task(s).`));
    wsServer.sendEvent({ type: 'status', data: { message: 'Tasks cancelled.' } });
    deps.pendingTasks.length = 0;
  });

  wsServer.onAppend(async (text: string) => {
    if (!brain || !deps.lastObservation.current) return;
    console.log(chalk.cyan(`[Nova] Appending to request: "${text}"`));

    const originalTranscript = deps.lastObservation.current.transcript ?? '';
    const mergedTranscript = `${originalTranscript}. Additionally: ${text}`;
    const updatedObservation: Observation = {
      ...deps.lastObservation.current,
      transcript: mergedTranscript,
    };

    deps.pendingTasks.length = 0;
    wsServer.sendEvent({
      type: 'status',
      data: { message: `Re-analyzing with: "${text}"...` },
    });

    try {
      logger.logAnalyzing(mergedTranscript);
      const tasks = await brain.analyze(updatedObservation, projectMap);
      logger.logTasks(tasks);

      if (tasks.length === 0) {
        wsServer.sendEvent({ type: 'status', data: { message: 'No tasks generated.' } });
        return;
      }

      deps.pendingTasks.push(...tasks);
      const taskDescriptions = tasks.map((t, i) => `${i + 1}. ${t.description}`).join('; ');
      const pendingMessage = `Press Y to execute, N to discard — ${taskDescriptions}`;
      console.log(chalk.yellow(`\n${pendingMessage}\n`));
      wsServer.sendEvent({
        type: 'pending_tasks',
        data: {
          tasks: tasks.map((t) => ({
            id: t.id,
            description: t.description,
            lane: t.lane,
            preConfirmed: t.preConfirmed,
          })),
          message: pendingMessage,
        },
      });
      wsServer.sendEvent({ type: 'status', data: { message: 'Awaiting confirmation' } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Analysis error: ${message}`));
      wsServer.sendEvent({ type: 'status', data: { message: `Analysis error: ${message}` } });
    }
  });

  // ── Forward task events to overlay ────────────────────────────────
  eventBus.on('task_created', (event) => {
    taskMap.set(event.data.id, event.data);
    logger.logTaskStarted(event.data);
    wsServer.sendEvent(event);
  });

  eventBus.on('task_completed', (event) => {
    const task = taskMap.get(event.data.taskId);
    if (task) {
      task.commitHash = event.data.commitHash;
      logger.logTaskCompleted(task);
    }
    wsServer.sendEvent(event);

    // Post-task health check
    setTimeout(async () => {
      if (autoFixer?.isAutofixTask(event.data.taskId)) return;

      const logs = devServer.getLogs();
      const recentLogs = logs.slice(-2000);
      const hasLogError =
        /error|Error|failed|Failed|Module not found|SyntaxError|TypeError/i.test(recentLogs) &&
        !/Successfully compiled|Compiled/.test(recentLogs.slice(-500));

      if (hasLogError && autoFixer) {
        const errorLines = recentLogs
          .split('\n')
          .filter((l) => /error|Error|failed|Module not found/i.test(l))
          .slice(-5)
          .join('\n');
        if (errorLines.trim()) {
          console.log(
            chalk.yellow(`[Nova] Post-task health check: build errors detected, auto-fixing...`),
          );
          wsServer.sendEvent({
            type: 'status',
            data: { message: 'Post-task check: fixing build errors...' },
          });
          autoFixer.forceFixNow(errorLines);
          return;
        }
      }

      try {
        const devPort = config.project.port || 3000;
        const http = await import('node:http');
        const res = await new Promise<{ statusCode?: number }>((resolve) => {
          const req = http.get(`http://localhost:${devPort}`, resolve);
          req.on('error', () => resolve({ statusCode: 0 }));
          req.setTimeout(5000, () => {
            req.destroy();
            resolve({ statusCode: 0 });
          });
        });
        if (res.statusCode && res.statusCode >= 500) {
          console.log(
            chalk.yellow(`[Nova] Post-task health check: HTTP ${res.statusCode}, auto-fixing...`),
          );
          wsServer.sendEvent({
            type: 'status',
            data: { message: `Site returned ${res.statusCode}, auto-fixing...` },
          });
          autoFixer?.forceFixNow(
            `Dev server returned HTTP ${res.statusCode} after code changes`,
          );
        }
      } catch {
        // health check failed silently
      }
    }, 1500);
  });

  eventBus.on('task_failed', (event) => {
    const task = taskMap.get(event.data.taskId);
    if (task) {
      task.error = event.data.error;
      logger.logTaskFailed(task);
    }
    wsServer.sendEvent(event);
  });

  eventBus.on('file_changed', (event) => {
    logger.logFileChanged(event.data.filePath);
  });

  eventBus.on('llm_chunk', (event) => {
    wsServer.sendEvent(event);
  });

  eventBus.on('secrets_required', (event) => {
    wsServer.sendEvent(event);
  });

  eventBus.on('status', (event) => {
    wsServer.sendEvent(event);
  });

  // ── Secrets submission ────────────────────────────────────────────
  wsServer.onSecretsSubmit((secrets: Record<string, string>) => {
    console.log(
      chalk.cyan(`[Nova] Saving ${Object.keys(secrets).length} secret(s) to .env.local`),
    );
    const envDetector = new EnvDetector();
    envDetector.writeEnvLocal(process.cwd(), secrets);
    envDetector.ensureGitignored(process.cwd());
    wsServer.sendEvent({
      type: 'status',
      data: { message: `Saved ${Object.keys(secrets).length} secret(s) to .env.local` },
    });
  });

  // ── Browser errors → autoFixer ────────────────────────────────────
  wsServer.onBrowserError((error: string) => {
    console.log(chalk.yellow(`[Nova] Browser error: ${error.slice(0, 150)}`));
    autoFixer?.handleOutput(error);
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

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
