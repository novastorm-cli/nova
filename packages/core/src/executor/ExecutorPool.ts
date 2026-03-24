import type { IExecutorPool, ILane1Executor, ILane2Executor } from '../contracts/IExecutor.js';
import type { IGitManager } from '../contracts/IGitManager.js';
import type { IPathGuard } from '../contracts/IPathGuard.js';
import type { IAgentPromptLoader } from '../contracts/IStorage.js';
import type { EventBus } from '../models/events.js';
import type { TaskItem, ProjectMap, ExecutionResult, LlmClient } from '../models/types.js';
import type { Lane4Executor } from './Lane4Executor.js';
import { Lane3Executor } from './Lane3Executor.js';
import { CommitQueue } from '../git/CommitQueue.js';

export class ExecutorPool implements IExecutorPool {
  private readonly lane3Micro: Lane3Executor | null;
  private readonly lane3Standard: Lane3Executor | null;
  private readonly lane3Strong: Lane3Executor | null;

  constructor(
    private readonly lane1: ILane1Executor,
    private readonly lane2: ILane2Executor,
    private readonly eventBus: EventBus,
    private readonly llm?: LlmClient,
    gitManager?: IGitManager,
    projectPath?: string,
    microModel?: string,
    standardModel?: string,
    strongModel?: string,
    agentPromptLoader?: IAgentPromptLoader,
    pathGuard?: IPathGuard,
    private readonly lane4?: Lane4Executor,
    commitQueue?: CommitQueue,
  ) {
    // Lane 1 fallback uses micro, Lane 2 fallback uses standard, Lane 3-4 use strong
    const sharedQueue = commitQueue ?? (gitManager ? new CommitQueue(gitManager) : undefined);
    this.lane3Micro = (llm && gitManager && projectPath)
      ? new Lane3Executor(projectPath, llm, gitManager, this.eventBus, 3, microModel, agentPromptLoader, pathGuard, sharedQueue)
      : null;
    this.lane3Standard = (llm && gitManager && projectPath)
      ? new Lane3Executor(projectPath, llm, gitManager, this.eventBus, 3, standardModel, agentPromptLoader, pathGuard, sharedQueue)
      : null;
    this.lane3Strong = (llm && gitManager && projectPath)
      ? new Lane3Executor(projectPath, llm, gitManager, this.eventBus, 3, strongModel, agentPromptLoader, pathGuard, sharedQueue)
      : null;
  }

  async execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult> {
    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });

    let result: ExecutionResult;

    try {
      switch (task.lane) {
        case 1: {
          // Try Lane 1 (CSS/regex), fallback to micro Lane 3 if it can't handle it
          result = await this.lane1.execute(task, projectMap);
          if (!result.success && this.lane3Micro) {
            console.log(`[Nova] Lane 1 failed, falling back to micro model`);
            result = await this.lane3Micro.execute(task, projectMap);
          }
          break;
        }
        case 2: {
          // Try Lane 2 (diff-based), fallback to standard Lane 3 if diff fails
          result = await this.lane2.execute(task, projectMap);
          if (!result.success && this.lane3Standard) {
            console.log(`[Nova] Lane 2 failed, falling back to standard model`);
            result = await this.lane3Standard.execute(task, projectMap);
          }
          break;
        }
        case 3: {
          // Standard: use strong model
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
          // Lane 4 (refactor/complex): background executor or fallback to strong model
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
        default: {
          const _exhaustive: never = task.lane;
          result = {
            success: false,
            taskId: task.id,
            error: `Unknown lane: ${_exhaustive}`,
          };
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.eventBus.emit({
        type: 'task_failed',
        data: { taskId: task.id, error: errorMessage },
      });
      return {
        success: false,
        taskId: task.id,
        error: errorMessage,
      };
    }

    if (result.success) {
      this.eventBus.emit({
        type: 'task_completed',
        data: {
          taskId: task.id,
          diff: result.diff ?? '',
          commitHash: result.commitHash ?? '',
        },
      });
    } else {
      this.eventBus.emit({
        type: 'task_failed',
        data: { taskId: task.id, error: result.error ?? 'Unknown error' },
      });
    }

    return result;
  }
}
