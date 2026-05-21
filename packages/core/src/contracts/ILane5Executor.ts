import type { TaskItem, ProjectMap, ExecutionResult } from '../models/types.js';

export interface ILane5Executor {
  /**
   * Executes a mission-based task (Lane 5).
   *
   * Lane 5 decomposes complex tasks into features via an orchestrator LLM,
   * executes them with parallel workers, validates results, and iterates
   * under a director review loop until approved or max iterations reached.
   *
   * Process:
   * 1. Orchestrator decomposes task into MissionPlan with features
   * 2. Emits mission_planned, awaits user confirmation (unless autoApprove)
   * 3. Workers execute features (parallel for independent, sequential for dependent)
   * 4. Director reviews results, returns verdict
   * 5. If NEEDS_REVISION, retry failed features up to maxIterations
   * 6. Commit all changes via CommitQueue
   * 7. Emit mission_completed or mission_failed
   *
   * @returns ExecutionResult with diff and commitHash on success
   */
  execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult>;
}
