import type { IExecutorPool, ILane1Executor, ILane2Executor } from '../contracts/IExecutor.js';
import type { IGitManager } from '../contracts/IGitManager.js';
import type { IPathGuard } from '../contracts/IPathGuard.js';
import type { IAgentPromptLoader } from '../contracts/IStorage.js';
import type { ILogger } from '../contracts/ILogger.js';
import type { EventBus } from '../contracts/IEventBus.js';
import type { TaskItem, ProjectMap, ExecutionResult } from '../models/types.js';
import type { LlmClient } from '../contracts/ILlmClient.js';
import type { Lane4Executor } from './Lane4Executor.js';
import type { Lane5Executor } from './Lane5Executor.js';
import { Lane3Executor } from './Lane3Executor.js';
import { ExecutorFSM, ExecutorState } from './ExecutorFSM.js';
import { RetryPolicy } from './RetryPolicy.js';
import { CommitQueue } from '../git/CommitQueue.js';

export class ExecutorPool implements IExecutorPool {
  private readonly lane3Micro: Lane3Executor | null;
  private readonly lane3Standard: Lane3Executor | null;
  private readonly lane3Strong: Lane3Executor | null;
  private readonly fsm: ExecutorFSM;
  private readonly retryPolicy: RetryPolicy;

  constructor(
    private readonly lane1: ILane1Executor,
    private readonly lane2: ILane2Executor,
    private readonly eventBus: EventBus,
    private readonly logger?: ILogger,
    private readonly llm?: LlmClient,
    gitManager?: IGitManager,
    projectPath?: string,
    microModel?: string,
    standardModel?: string,
    strongModel?: string,
    agentPromptLoader?: IAgentPromptLoader,
    pathGuard?: IPathGuard,
    private readonly lane4?: Lane4Executor,
    private readonly lane5?: Lane5Executor,
    commitQueue?: CommitQueue,
    retryPolicy?: RetryPolicy,
  ) {
    this.fsm = new ExecutorFSM(this.eventBus, this.logger);
    this.retryPolicy = retryPolicy ?? new RetryPolicy(3, this.logger);

    // Lane 1 fallback uses micro, Lane 2 fallback uses standard, Lane 3-4 use strong
    const sharedQueue = commitQueue ?? (gitManager ? new CommitQueue(gitManager) : undefined);
    this.lane3Micro =
      llm && gitManager && projectPath
        ? new Lane3Executor(
            projectPath,
            llm,
            gitManager,
            this.eventBus,
            3,
            microModel,
            agentPromptLoader,
            pathGuard,
            sharedQueue,
            false, // forceSkipValidation
            this.logger?.child({ lane: 'lane3-micro' }),
          )
        : null;
    this.lane3Standard =
      llm && gitManager && projectPath
        ? new Lane3Executor(
            projectPath,
            llm,
            gitManager,
            this.eventBus,
            3,
            standardModel,
            agentPromptLoader,
            pathGuard,
            sharedQueue,
            false,
            this.logger?.child({ lane: 'lane3-standard' }),
          )
        : null;
    this.lane3Strong =
      llm && gitManager && projectPath
        ? new Lane3Executor(
            projectPath,
            llm,
            gitManager,
            this.eventBus,
            3,
            strongModel,
            agentPromptLoader,
            pathGuard,
            sharedQueue,
            false,
            this.logger?.child({ lane: 'lane3-strong' }),
          )
        : null;
  }

  async execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult> {
    const taskLog = this.logger?.child({ taskId: task.id });

    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });

    // FSM: Planning → Generating
    this.fsm.transition(task.id, ExecutorState.Planning, ExecutorState.Generating);

    let result: ExecutionResult;

    try {
      switch (task.lane) {
        case 1: {
          // Lane 1 (regex/AST) — no LLM, fast apply
          result = await this.lane1.execute(task, projectMap);

          if (!result.success && this.lane3Micro) {
            taskLog?.info('Lane 1 failed, falling back to micro model', {
              taskId: task.id,
              error: result.error,
            });
            this.fsm.transition(task.id, ExecutorState.Applying, ExecutorState.Generating);
            result = await this.lane3Micro.execute(task, projectMap);
          }
          break;
        }
        case 2: {
          // Lane 2 (diff-based, single LLM call)
          result = await this.lane2.execute(task, projectMap);

          if (!result.success && this.lane3Standard) {
            taskLog?.info('Lane 2 failed, falling back to standard model', {
              taskId: task.id,
              error: result.error,
            });
            this.fsm.transition(task.id, ExecutorState.Applying, ExecutorState.Generating);
            result = await this.lane3Standard.execute(task, projectMap);
          }
          break;
        }
        case 3: {
          // Lane 3 (multi-file)
          if (!this.lane3Strong) {
            result = {
              success: false,
              taskId: task.id,
              error: 'Lane 3 requires LLM + Git configuration',
            };
            break;
          }
          result = await this.lane3Strong.execute(task, projectMap);
          break;
        }
        case 4: {
          // Lane 4 (background refactor)
          if (this.lane4) {
            result = await this.lane4.execute(task, projectMap);
            break;
          }
          if (!this.lane3Strong) {
            result = {
              success: false,
              taskId: task.id,
              error: 'Lane 4 requires LLM + Git configuration',
            };
            break;
          }
          result = await this.lane3Strong.execute(task, projectMap);
          break;
        }
        case 5: {
          // Lane 5 (mission-based) — requires Lane5Executor
          if (!this.lane5) {
            result = {
              success: false,
              taskId: task.id,
              error: 'Lane 5 requires LLM + Git configuration',
            };
            break;
          }
          result = await this.lane5.execute(task, projectMap);
          break;
        }
        default: {
          const _exhaustive: never = task.lane;
          result = {
            success: false,
            taskId: task.id,
            error: `Unknown lane: ${String(_exhaustive)}`,
          };
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      taskLog?.error('Task execution failed with exception', {
        taskId: task.id,
        error: errorMessage,
      });

      this.fsm.transition(task.id, ExecutorState.Applying, ExecutorState.Failed);

      this.eventBus.emit({
        type: 'task_failed',
        data: { taskId: task.id, error: errorMessage },
      });

      this.retryPolicy.reset(task.id);
      this.fsm.reset(task.id);
      return {
        success: false,
        taskId: task.id,
        error: errorMessage,
      };
    }

    if (result.success) {
      taskLog?.info('Task completed successfully', {
        taskId: task.id,
        commitHash: result.commitHash,
      });

      this.fsm.transition(task.id, ExecutorState.Validating, ExecutorState.Committing);

      this.eventBus.emit({
        type: 'task_completed',
        data: {
          taskId: task.id,
          diff: result.diff ?? '',
          commitHash: result.commitHash ?? '',
        },
      });
    } else {
      taskLog?.warn('Task failed', {
        taskId: task.id,
        error: result.error,
      });

      this.fsm.transition(task.id, ExecutorState.Applying, ExecutorState.Failed);

      this.eventBus.emit({
        type: 'task_failed',
        data: { taskId: task.id, error: result.error ?? 'Unknown error' },
      });
    }

    // Clean up task state
    this.retryPolicy.reset(task.id);
    this.fsm.reset(task.id);

    return result;
  }

  /** Access the shared retry policy (for testing/monitoring). */
  getRetryPolicy(): RetryPolicy {
    return this.retryPolicy;
  }

  /** Access the FSM (for testing/monitoring). */
  getFsm(): ExecutorFSM {
    return this.fsm;
  }
}
