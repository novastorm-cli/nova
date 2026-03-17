import type { IExecutorPool, ILane1Executor, ILane2Executor } from '../contracts/IExecutor.js';
import type { IGitManager } from '../contracts/IGitManager.js';
import type { EventBus } from '../models/events.js';
import type { TaskItem, ProjectMap, ExecutionResult, LlmClient } from '../models/types.js';
import { Lane3Executor } from './Lane3Executor.js';

export class ExecutorPool implements IExecutorPool {
  private readonly lane3Fast: Lane3Executor | null;
  private readonly lane3Strong: Lane3Executor | null;

  constructor(
    private readonly lane1: ILane1Executor,
    private readonly lane2: ILane2Executor,
    private readonly eventBus: EventBus,
    private readonly llm?: LlmClient,
    gitManager?: IGitManager,
    projectPath?: string,
    fastModel?: string,
    strongModel?: string,
  ) {
    // Lane 1-2 fallbacks use fast model, Lane 3-4 use strong model
    this.lane3Fast = (llm && gitManager && projectPath)
      ? new Lane3Executor(projectPath, llm, gitManager, this.eventBus, 3, fastModel)
      : null;
    this.lane3Strong = (llm && gitManager && projectPath)
      ? new Lane3Executor(projectPath, llm, gitManager, this.eventBus, 3, strongModel)
      : null;
  }

  async execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult> {
    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });

    let result: ExecutionResult;

    try {
      switch (task.lane) {
        case 1: {
          // Try Lane 1 (CSS/regex), fallback to fast Lane 3 if it can't handle it
          result = await this.lane1.execute(task, projectMap);
          if (!result.success && this.lane3Fast) {
            console.log(`[Nova] Lane 1 failed, falling back to fast model`);
            result = await this.lane3Fast.execute(task, projectMap);
          }
          break;
        }
        case 2: {
          // Try Lane 2 (diff-based), fallback to fast Lane 3 if diff fails
          result = await this.lane2.execute(task, projectMap);
          if (!result.success && this.lane3Fast) {
            console.log(`[Nova] Lane 2 failed, falling back to fast model`);
            result = await this.lane3Fast.execute(task, projectMap);
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
          // Lane 4 (refactor/complex): use strong model
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
