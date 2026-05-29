import type { TaskItem, ProjectMap, MissionPlan } from '../models/types.js';

export class CircularDependencyError extends Error {
  constructor(public readonly cyclePath: string[]) {
    super(`Circular dependency detected: ${cyclePath.join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

export class MissingDependencyError extends Error {
  constructor(missingId: string) {
    super(`Missing dependency reference: feature "${missingId}" not found in plan`);
    this.name = 'MissingDependencyError';
  }
}

export interface IOrchestrator {
  /**
   * Decomposes a task into a MissionPlan with features and dependencies.
   *
   * Process:
   * 1. Builds prompt with task description + ProjectMap context
   * 2. Calls the orchestrator LLM (stronger model)
   * 3. Parses structured JSON response into features
   * 4. Validates: no circular dependencies, all dependency refs exist,
   *    file paths don't escape the project directory
   * 5. Topologically sorts features by dependency order
   *
   * @returns MissionPlan with validated, topologically sorted features
   * @throws {CircularDependencyError} if the dependency graph has a cycle
   * @throws {MissingDependencyError} if a feature references a non-existent dependency
   */
  plan(task: TaskItem, projectMap: ProjectMap): Promise<MissionPlan>;
}
