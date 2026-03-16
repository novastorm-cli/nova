import type { IExecutorPool, ILane1Executor, ILane2Executor } from '../contracts/IExecutor.js';
import type { EventBus } from '../models/events.js';
import type { TaskItem, ProjectMap, ExecutionResult } from '../models/types.js';

export class ExecutorPool implements IExecutorPool {
  constructor(
    private readonly lane1: ILane1Executor,
    private readonly lane2: ILane2Executor,
    private readonly eventBus: EventBus,
  ) {}

  async execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult> {
    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });

    let result: ExecutionResult;

    try {
      switch (task.lane) {
        case 1:
          result = await this.lane1.execute(task, projectMap);
          break;
        case 2:
          result = await this.lane2.execute(task, projectMap);
          break;
        case 3:
          // Lane 3 decomposes via TaskDecomposer then executes subtasks.
          // Not yet implemented - will be added when TaskDecomposer is available.
          result = {
            success: false,
            taskId: task.id,
            error: 'Lane 3 executor not yet implemented',
          };
          break;
        case 4:
          // Lane 4 spawns a background process.
          // Not yet implemented - will be added when background process support is available.
          result = {
            success: false,
            taskId: task.id,
            error: 'Lane 4 executor not yet implemented',
          };
          break;
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
