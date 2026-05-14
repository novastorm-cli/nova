import type { TaskItem, ProjectMap, ExecutionResult } from '../models/types.js';
import type { LlmClient } from '../contracts/ILlmClient.js';
import type { IGitManager } from '../contracts/IGitManager.js';
import type { IPathGuard } from '../contracts/IPathGuard.js';
import type { IAgentPromptLoader } from '../contracts/IStorage.js';
import type { ILogger } from '../contracts/ILogger.js';
import type { EventBus } from '../contracts/IEventBus.js';
import { Lane3Executor } from './Lane3Executor.js';
import { BackgroundQueue } from './BackgroundQueue.js';

const POLL_INTERVAL_MS = 5_000;

export class Lane4Executor {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(
    private readonly projectPath: string,
    private readonly llm: LlmClient,
    private readonly gitManager: IGitManager,
    private readonly eventBus: EventBus,
    private readonly queue: BackgroundQueue,
    private readonly model?: string,
    private readonly agentPromptLoader?: IAgentPromptLoader,
    private readonly pathGuard?: IPathGuard,
    private readonly logger?: ILogger,
  ) {}

  async execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult> {
    const bgTask = await this.queue.enqueue(task);
    const pending = await this.queue.getPending();

    this.eventBus.emit({
      type: 'background_queued',
      data: { taskId: task.id, position: pending.length },
    });

    // Fire-and-forget: process in background
    this.processTask(bgTask.id, task, projectMap).catch((err) => {
      this.logger?.error('Lane4: unhandled error processing task', {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return { success: true, taskId: task.id };
  }

  async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      let bgTask = await this.queue.dequeue();
      while (bgTask) {
        await this.processTask(bgTask.id, bgTask.task, undefined);
        bgTask = await this.queue.dequeue();
      }
    } finally {
      this.processing = false;
    }
  }

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.processQueue().catch((err) => {
        this.logger?.error('Lane4: poll error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async processTask(
    bgTaskId: string,
    task: TaskItem,
    projectMap: ProjectMap | undefined,
  ): Promise<void> {
    let branch: string | undefined;

    try {
      // Create a separate branch for background work
      branch = await this.gitManager.createBranch('nova/bg-');

      await this.queue.update(bgTaskId, { status: 'running', startedAt: Date.now(), branch });

      this.eventBus.emit({
        type: 'background_started',
        data: { taskId: task.id, branch },
      });

      this.eventBus.emit({
        type: 'background_progress',
        data: { taskId: task.id, progress: 'Generating code on background branch...' },
      });

      // Use Lane3Executor for actual code generation
      const lane3 = new Lane3Executor(
        this.projectPath,
        this.llm,
        this.gitManager,
        this.eventBus,
        3,
        this.model,
        this.agentPromptLoader,
        this.pathGuard,
        undefined, // commitQueue — use default
        false, // forceSkipValidation
        this.logger?.child({ lane: 'lane4-bg' }),
      );

      // If no projectMap provided (from processQueue), build a minimal one
      const map = projectMap ?? this.buildMinimalProjectMap();

      const result = await lane3.execute(task, map);

      if (result.success) {
        await this.queue.update(bgTaskId, {
          status: 'completed',
          completedAt: Date.now(),
          commitHash: result.commitHash,
          diff: result.diff,
        });

        this.eventBus.emit({
          type: 'background_completed',
          data: {
            taskId: task.id,
            branch,
            commitHash: result.commitHash ?? '',
            diff: result.diff ?? '',
          },
        });
      } else {
        await this.queue.update(bgTaskId, {
          status: 'failed',
          completedAt: Date.now(),
          error: result.error,
        });

        this.eventBus.emit({
          type: 'background_failed',
          data: { taskId: task.id, error: result.error ?? 'Unknown error' },
        });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      try {
        await this.queue.update(bgTaskId, {
          status: 'failed',
          completedAt: Date.now(),
          error: errorMessage,
        });
      } catch {
        // Queue update failed — not critical
      }

      this.eventBus.emit({
        type: 'background_failed',
        data: { taskId: task.id, error: errorMessage },
      });
    }
  }

  private buildMinimalProjectMap(): ProjectMap {
    return {
      stack: { framework: 'unknown', language: 'typescript', typescript: true },
      devCommand: '',
      port: 3000,
      routes: [],
      components: [],
      endpoints: [],
      models: [],
      dependencies: new Map(),
      fileContexts: new Map(),
      compressedContext: '',
    };
  }
}
