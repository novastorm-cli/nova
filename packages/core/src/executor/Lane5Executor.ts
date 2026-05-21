import type {
  TaskItem,
  ProjectMap,
  ExecutionResult,
  MissionPlan,
  MissionFeature,
  MissionState,
  FeatureResult,
} from '../models/types.js';
import type { NovaEvent } from '../models/events.js';
import type { LlmClient } from '../contracts/ILlmClient.js';
import type { IGitManager } from '../contracts/IGitManager.js';
import type { IPathGuard } from '../contracts/IPathGuard.js';
import type { IAgentPromptLoader } from '../contracts/IStorage.js';
import type { ILogger } from '../contracts/ILogger.js';
import type { EventBus } from '../contracts/IEventBus.js';
import type { ILane5Executor } from '../contracts/ILane5Executor.js';
import { CommitQueue } from '../git/CommitQueue.js';
import { MissionOrchestrator } from './MissionOrchestrator.js';
import { MissionWorker } from './MissionWorker.js';
import { MissionDirector } from './MissionDirector.js';
import { MissionStore } from './MissionStore.js';

export interface MissionConfig {
  enabled: boolean;
  autoApprove: boolean;
  maxIterations: number;
}

const SCOPED_TASK_ID = 'laner://5';

export class Lane5Executor implements ILane5Executor {
  private readonly commitQueue: CommitQueue;
  private readonly missionStore: MissionStore;
  private readonly orchestrator: MissionOrchestrator;
  private readonly director: MissionDirector;
  private readonly maxIterations: number;
  private readonly autoApprove: boolean;
  private readonly workerModel: string;

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
    workerModel?: string,
  ) {
    this.commitQueue = commitQueue ?? new CommitQueue(this.gitManager);

    const orchModel = orchestratorModel ?? 'claude-sonnet-4-6';
    this.workerModel = workerModel ?? orchModel;

    this.missionStore = new MissionStore(this.projectPath, this.logger);
    this.orchestrator = new MissionOrchestrator(this.llmClient, orchModel, this.logger);
    this.director = new MissionDirector(this.llmClient, orchModel, this.logger);
    this.maxIterations = this.missionConfig?.maxIterations ?? 5;
    this.autoApprove = this.missionConfig?.autoApprove ?? false;
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

      // Generate mission ID
      const missionId = `mission-${task.id}`;

      taskLog?.info('Lane5Executor: starting mission lifecycle', {
        taskId: task.id,
        missionId,
        orchestratorModel: this.orchestratorModel,
        workerModel: this.workerModel,
        maxIterations: this.maxIterations,
        autoApprove: this.autoApprove,
      });

      // ── Phase 1: Plan ────────────────────────────────────────────

      taskLog?.info('Phase 1: Planning...', { taskId: task.id });

      this.eventBus.emit({
        type: 'status',
        data: { message: 'Orchestrator: planning mission features...' },
      });

      let plan: MissionPlan;
      try {
        plan = await this.orchestrator.plan(task, projectMap);
      } catch (planError: unknown) {
        const msg = planError instanceof Error ? planError.message : String(planError);
        taskLog?.error('Orchestrator planning failed', { taskId: task.id, error: msg });
        this.eventBus.emit({
          type: 'mission_failed',
          data: { taskId: task.id, error: `Orchestrator planning failed: ${msg}` },
        });
        return { success: false, taskId: task.id, error: `Planning failed: ${msg}` };
      }

      if (plan.features.length === 0) {
        taskLog?.warn('Orchestrator returned empty plan', { taskId: task.id });
        this.eventBus.emit({
          type: 'mission_failed',
          data: { taskId: task.id, error: 'Orchestrator returned an empty plan' },
        });
        return {
          success: false,
          taskId: task.id,
          error: 'Orchestrator returned an empty plan',
        };
      }

      taskLog?.info(`Planned ${plan.features.length} features`, {
        taskId: task.id,
        features: plan.features.map((f) => f.id),
      });

      // Create initial mission state
      const state: MissionState = {
        id: missionId,
        taskId: task.id,
        status: 'awaiting_confirmation',
        plan,
        featureResults: {},
        iteration: 0,
        maxIterations: this.maxIterations,
      };

      await this.missionStore.save(state);

      // Emit mission_planned
      this.eventBus.emit({
        type: 'mission_planned',
        data: { taskId: task.id, plan },
      });

      // ── Phase 2: Confirmation ────────────────────────────────────

      if (!this.autoApprove) {
        taskLog?.info('Phase 2: Awaiting user confirmation...', { taskId: task.id });

        this.eventBus.emit({
          type: 'pending_tasks',
          data: {
            tasks: plan.features.map((f) => ({
              id: f.id,
              description: f.description,
              lane: 5,
            })),
            message: `${plan.features.length} features planned. Confirm to execute.`,
          },
        });

        try {
          await this.waitForConfirmation(task.id);
        } catch (confirmError: unknown) {
          const msg =
            confirmError instanceof Error ? confirmError.message : String(confirmError);
          taskLog?.info('Mission cancelled by user', { taskId: task.id });
          state.status = 'failed';
          await this.missionStore.save(state);
          this.eventBus.emit({
            type: 'mission_failed',
            data: { taskId: task.id, error: msg },
          });
          return { success: false, taskId: task.id, error: msg };
        }
      }

      // ── Phase 3: Execute features ────────────────────────────────

      taskLog?.info('Phase 3: Executing features...', {
        taskId: task.id,
        featureCount: plan.features.length,
      });

      state.status = 'executing';
      await this.missionStore.save(state);

      await this.executeFeatures(plan, task, projectMap, state);

      taskLog?.info('Features executed', {
        taskId: task.id,
        results: Object.entries(state.featureResults).map(([id, r]) => ({
          id,
          success: r.success,
        })),
      });

      // ── Phase 4: Director review loop ─────────────────────────────

      for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
        taskLog?.info(`Phase 4: Director review (iteration ${iteration}/${this.maxIterations})`, {
          taskId: task.id,
        });

        state.iteration = iteration;
        state.status = 'reviewing';
        await this.missionStore.save(state);

        this.eventBus.emit({
          type: 'status',
          data: {
            message: `Director: reviewing mission results (${iteration}/${this.maxIterations})...`,
          },
        });

        const verdict = await this.director.review(task, plan, state.featureResults);
        state.directorVerdict = verdict;
        await this.missionStore.save(state);

        this.eventBus.emit({
          type: 'mission_director_review',
          data: { taskId: task.id, verdict },
        });

        taskLog?.info('Director verdict', {
          taskId: task.id,
          decision: verdict.decision,
          feedbackCount: verdict.feedback.length,
        });

        if (verdict.decision === 'APPROVED') {
          taskLog?.info('Director APPROVED - mission complete!', { taskId: task.id });
          state.status = 'completed';
          await this.missionStore.save(state);
          break;
        }

        if (verdict.decision === 'REJECTED') {
          taskLog?.warn('Director REJECTED the mission', { taskId: task.id });
          state.status = 'failed';
          await this.missionStore.save(state);
          break;
        }

        // NEEDS_REVISION
        taskLog?.info('Director requests revisions', {
          taskId: task.id,
          feedback: verdict.feedback,
        });

        if (iteration >= this.maxIterations) {
          taskLog?.warn('Max review iterations reached, finalizing with warnings', {
            taskId: task.id,
            maxIterations: this.maxIterations,
          });
          state.status = 'completed';
          await this.missionStore.save(state);
          break;
        }

        // Emit iteration event
        this.eventBus.emit({
          type: 'mission_iteration',
          data: { taskId: task.id, iteration, maxIterations: this.maxIterations },
        });

        // Determine which features need retry
        const featuresToRetry = this.getFeaturesToRetry(
          plan,
          state.featureResults,
          verdict,
        );

        if (featuresToRetry.length === 0) {
          taskLog?.warn(
            'No features to retry despite NEEDS_REVISION - treating as approved',
            { taskId: task.id },
          );
          state.status = 'completed';
          await this.missionStore.save(state);
          break;
        }

        taskLog?.info(`Retrying ${featuresToRetry.length} features`, {
          taskId: task.id,
          features: featuresToRetry.map((f) => f.id),
        });

        // Re-execute failed features with retry context
        await this.executeFeaturesWithRetry(
          featuresToRetry,
          task,
          projectMap,
          state,
          verdict,
        );
      }

      // ── Phase 5: Commit ──────────────────────────────────────────

      const finalStatus = state.status;

      if (finalStatus === 'completed') {
        taskLog?.info('Phase 5: Committing changes...', { taskId: task.id });

        this.eventBus.emit({
          type: 'status',
          data: { message: 'Committing mission changes...' },
        });

        try {
          const allFiles = this.collectWrittenFiles(state.featureResults);
          const allDeletedFiles = this.collectDeletedFiles(state.featureResults);

          const diffLines = [
            ...allFiles.map((p) => `+++ ${p}`),
            ...allDeletedFiles.map((p) => `--- ${p}`),
          ];
          const combinedDiff = diffLines.join('\n');

          const commitMessage = `feat: ${task.description.slice(0, 72)}`;

          const filesToCommit: string[] = [...allFiles, ...allDeletedFiles];

          // If no files to commit, still succeed
          let commitHash = '';
          if (filesToCommit.length > 0) {
            commitHash = await this.commitQueue.enqueue(
              commitMessage,
              filesToCommit,
              SCOPED_TASK_ID,
            );
            taskLog?.info('Commit successful', { taskId: task.id, commitHash });
          } else {
            taskLog?.info('No files to commit', { taskId: task.id });
          }

          this.eventBus.emit({
            type: 'mission_completed',
            data: { taskId: task.id, commitHash },
          });

          return {
            success: true,
            taskId: task.id,
            diff: combinedDiff || undefined,
            commitHash: commitHash || undefined,
          };
        } catch (commitError: unknown) {
          const msg =
            commitError instanceof Error ? commitError.message : String(commitError);
          taskLog?.error('Commit failed', { taskId: task.id, error: msg });
          this.eventBus.emit({
            type: 'mission_failed',
            data: { taskId: task.id, error: `Commit failed: ${msg}` },
          });
          return { success: false, taskId: task.id, error: `Commit failed: ${msg}` };
        }
      }

      // Mission failed
      taskLog?.info('Mission failed', { taskId: task.id, status: finalStatus });

      const errorMsg =
        finalStatus === 'failed'
          ? state.directorVerdict?.decision === 'REJECTED'
            ? 'Mission rejected by director'
            : 'Mission failed'
          : `Mission ended with status: ${finalStatus}`;

      this.eventBus.emit({
        type: 'mission_failed',
        data: { taskId: task.id, error: errorMsg },
      });

      return { success: false, taskId: task.id, error: errorMsg };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      taskLog?.error('Lane 5 execution failed with exception', {
        taskId: task.id,
        error: errorMessage,
      });

      this.eventBus.emit({
        type: 'mission_failed',
        data: { taskId: task.id, error: errorMessage },
      });

      return {
        success: false,
        taskId: task.id,
        error: errorMessage,
      };
    }
  }

  // ── Feature execution ──────────────────────────────────────────────

  /**
   * Execute all features in the plan. Independent features run in parallel,
   * dependent features wait for their dependencies to complete.
   */
  private async executeFeatures(
    plan: MissionPlan,
    task: TaskItem,
    projectMap: ProjectMap,
    state: MissionState,
  ): Promise<void> {
    const results = new Map<string, Promise<void>>();

    // Execute features respecting dependency order
    // Create a map from feature ID to completion promise
    for (const feature of plan.features) {
      results.set(
        feature.id,
        this.executeFeatureWithDeps(feature, task, projectMap, state, results),
      );
    }

    // Wait for all features to complete
    await Promise.all(Array.from(results.values()));
  }

  /**
   * Execute a single feature, waiting for its dependencies first.
   * If a dependency fails, the dependent feature is marked as failed (cascading failure).
   */
  private async executeFeatureWithDeps(
    feature: MissionFeature,
    task: TaskItem,
    projectMap: ProjectMap,
    state: MissionState,
    dependencyPromises: Map<string, Promise<void>>,
  ): Promise<void> {
    // Wait for all dependencies
    if (feature.dependencies.length > 0) {
      const depResults = await Promise.allSettled(
        feature.dependencies.map((depId) => {
          const depPromise = dependencyPromises.get(depId);
          return depPromise ?? Promise.resolve();
        }),
      );

      // Check if any dependency failed
      for (let i = 0; i < depResults.length; i++) {
        const depResult = depResults[i]!;
        const depId = feature.dependencies[i]!;

        if (depResult.status === 'rejected') {
          // Dependency failed with an exception
          state.featureResults[feature.id] = {
            success: false,
            featureId: feature.id,
            error: `Dependency "${depId}" failed with exception`,
          };
          await this.missionStore.appendFeatureResult(
            state.id,
            feature.id,
            state.featureResults[feature.id]!,
          );
          // Don't execute this feature
          return;
        }

        // Check if the dependency itself failed
        const depFeatureResult = state.featureResults[depId];
        if (depFeatureResult && !depFeatureResult.success) {
          state.featureResults[feature.id] = {
            success: false,
            featureId: feature.id,
            error: `Dependency "${depId}" failed: ${depFeatureResult.error ?? 'Unknown error'}`,
          };
          await this.missionStore.appendFeatureResult(
            state.id,
            feature.id,
            state.featureResults[feature.id]!,
          );
          // Don't execute this feature - cascading failure
          return;
        }
      }
    }

    // Execute the feature
    await this.executeSingleFeature(feature, task, projectMap, state);
  }

  /**
   * Execute a single feature using MissionWorker.
   * Does NOT throw on worker failure - instead records the failure in state.
   */
  private async executeSingleFeature(
    feature: MissionFeature,
    task: TaskItem,
    projectMap: ProjectMap,
    state: MissionState,
  ): Promise<void> {
    this.eventBus.emit({
      type: 'mission_subtask_started',
      data: {
        taskId: task.id,
        featureId: feature.id,
        description: feature.description,
      },
    });

    const worker = new MissionWorker(
      this.projectPath,
      this.llmClient,
      this.workerModel,
      this.eventBus,
      this.pathGuard,
      this.logger,
    );

    let result: FeatureResult;
    try {
      result = await worker.execute(feature, projectMap);
    } catch (workerError: unknown) {
      const msg = workerError instanceof Error ? workerError.message : String(workerError);
      result = {
        success: false,
        featureId: feature.id,
        error: `Worker exception: ${msg}`,
      };
    }

    // Store result
    state.featureResults[feature.id] = result;
    await this.missionStore.appendFeatureResult(state.id, feature.id, result);

    this.eventBus.emit({
      type: 'mission_subtask_completed',
      data: {
        taskId: task.id,
        featureId: feature.id,
        result,
      },
    });
  }

  // ── Retry logic ────────────────────────────────────────────────────

  /**
   * Determine which features need to be retried based on the director's verdict.
   */
  private getFeaturesToRetry(
    plan: MissionPlan,
    featureResults: Record<string, FeatureResult>,
    verdict: import('../models/types.js').DirectorVerdict,
  ): MissionFeature[] {
    const failedFeatureIds = new Set<string>();

    // Collect features that director specifically called out
    for (const feedback of verdict.feedback) {
      if (feedback.featureId === 'all') {
        // All features need retry - add all that failed or have validation errors
        for (const [id, result] of Object.entries(featureResults)) {
          if (!result.success || (result.validationErrors && result.validationErrors.length > 0)) {
            failedFeatureIds.add(id);
          }
        }
      } else {
        failedFeatureIds.add(feedback.featureId);
      }
    }

    // If no specific features, retry all failed ones
    if (failedFeatureIds.size === 0) {
      for (const [id, result] of Object.entries(featureResults)) {
        if (!result.success) {
          failedFeatureIds.add(id);
        }
      }
    }

    // Filter plan features to only those needing retry
    return plan.features.filter((f) => failedFeatureIds.has(f.id));
  }

  /**
   * Execute specific features with retry context (director's feedback).
   */
  private async executeFeaturesWithRetry(
    featuresToRetry: MissionFeature[],
    task: TaskItem,
    projectMap: ProjectMap,
    state: MissionState,
    _verdict: import('../models/types.js').DirectorVerdict,
  ): Promise<void> {
    // Execute retry features - these are independent of each other
    const retryPromises = featuresToRetry.map((feature) =>
      this.executeSingleFeature(feature, task, projectMap, state),
    );

    await Promise.all(retryPromises);
  }

  // ── File collection ────────────────────────────────────────────────

  private collectWrittenFiles(
    featureResults: Record<string, FeatureResult>,
  ): string[] {
    const files = new Set<string>();
    for (const result of Object.values(featureResults)) {
      if (result.generatedFiles) {
        for (const file of result.generatedFiles) {
          files.add(file.path);
        }
      }
    }
    return Array.from(files);
  }

  private collectDeletedFiles(
    featureResults: Record<string, FeatureResult>,
  ): string[] {
    const files = new Set<string>();
    for (const result of Object.values(featureResults)) {
      if (result.deletedFiles) {
        for (const file of result.deletedFiles) {
          files.add(file);
        }
      }
    }
    return Array.from(files);
  }

  // ── Confirmation wait ──────────────────────────────────────────────

  /**
   * Wait for user confirmation via the EventBus.
   * Resolves when confirm_tasks for this taskId is received.
   * Rejects on cancel or timeout.
   */
  private waitForConfirmation(taskId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.eventBus.off('confirm_tasks', confirmHandler);
        this.eventBus.off('cancel', cancelHandler);
      };

      const confirmHandler = (event: NovaEvent): void => {
        if (
          event.type === 'confirm_tasks' &&
          'taskIds' in event.data &&
          Array.isArray(event.data.taskIds) &&
          event.data.taskIds.includes(taskId)
        ) {
          cleanup();
          resolve();
        }
      };

      const cancelHandler = (event: NovaEvent): void => {
        if (event.type === 'cancel') {
          cleanup();
          reject(new Error('Mission cancelled by user'));
        }
      };

      this.eventBus.on('confirm_tasks', confirmHandler);
      this.eventBus.on('cancel', cancelHandler);

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Mission confirmation timed out'));
      }, 300_000);
    });
  }
}
