import type { TaskItem, ProjectMap, ExecutionResult } from '../models/types.js';
import type { LlmClient } from '../contracts/ILlmClient.js';
import type { IGitManager } from '../contracts/IGitManager.js';
import type { IPathGuard } from '../contracts/IPathGuard.js';
import type { IAgentPromptLoader } from '../contracts/IStorage.js';
import type { ILogger } from '../contracts/ILogger.js';
import type { EventBus } from '../contracts/IEventBus.js';
import type { ILane5Executor } from '../contracts/ILane5Executor.js';
import { CommitQueue } from '../git/CommitQueue.js';

export interface MissionConfig {
  enabled: boolean;
  autoApprove: boolean;
  maxIterations: number;
}

export class Lane5Executor implements ILane5Executor {
  private readonly commitQueue: CommitQueue;

  constructor(
    private readonly projectPath: string,
    private readonly llmClient: LlmClient,
    private readonly gitManager: IGitManager,
    private readonly eventBus: EventBus,
    private readonly orchestratorModel?: string,
    private readonly missionConfig?: MissionConfig,
    private readonly agentPromptLoader?: IAgentPromptLoader,
    private readonly pathGuard?: IPathGuard,
    commitQueue?: CommitQueue,
    private readonly logger?: ILogger,
  ) {
    this.commitQueue = commitQueue ?? new CommitQueue(this.gitManager);
  }

  async execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult> {
    const taskLog = this.logger?.child({ taskId: task.id });

    try {
      // Check if mission execution is disabled
      if (this.missionConfig && !this.missionConfig.enabled) {
        const errorMsg = 'Mission execution is disabled in config';
        taskLog?.warn(errorMsg, { taskId: task.id });
        return {
          success: false,
          taskId: task.id,
          error: errorMsg,
        };
      }

      // Check for missing orchestrator model
      if (!this.orchestratorModel) {
        const errorMsg =
          'Lane 5 requires an orchestrator model. Set [models] orchestrator in nova.toml.';
        taskLog?.warn(errorMsg, { taskId: task.id });
        return {
          success: false,
          taskId: task.id,
          error: errorMsg,
        };
      }

      // Skeleton: return placeholder until full implementation
      taskLog?.info('Lane 5: skeleton execution (not yet implemented)', {
        taskId: task.id,
        orchestratorModel: this.orchestratorModel,
      });

      return {
        success: false,
        taskId: task.id,
        error: 'Lane 5: not yet implemented',
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      taskLog?.error('Lane 5 execution failed with exception', {
        taskId: task.id,
        error: errorMessage,
      });

      return {
        success: false,
        taskId: task.id,
        error: errorMessage,
      };
    }
  }
}
