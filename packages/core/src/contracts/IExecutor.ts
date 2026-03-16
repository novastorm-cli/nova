import type { TaskItem, ProjectMap, ExecutionResult, ValidationResult } from '../models/types.js';

export interface IExecutorPool {
  /**
   * Executes a task by routing it to the correct lane executor.
   *
   * Lane 1 → Lane1Executor (AST/regex, no LLM)
   * Lane 2 → Lane2Executor (single API call, fast model)
   * Lane 3 → decomposes via TaskDecomposer, then executes subtasks
   * Lane 4 → spawns background process
   *
   * Emits events via EventBus: task_started, task_completed, task_failed
   *
   * @returns ExecutionResult with diff and commit hash on success
   */
  execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult>;
}

export interface ILane1Executor {
  /**
   * Instant execution for CSS/text/visibility changes. No LLM.
   *
   * Process:
   * 1. Parse domSnapshot → extract CSS class / element identifier
   * 2. Find matching class/selector in source files (regex search)
   * 3. Apply regex/AST replacement (e.g. color: red → color: blue)
   * 4. Write file
   *
   * Falls back to Ollama (local model) if regex approach can't handle it.
   *
   * @returns ExecutionResult. diff contains the change made.
   * @throws if can't map DOM element to source file
   */
  execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult>;
}

export interface ILane2Executor {
  /**
   * Fast single-file execution via LLM.
   *
   * Process:
   * 1. Load pre-built mini-context for the target file
   * 2. Send to fast model: "modify this file to {task}. Respond with ONLY a unified diff."
   * 3. Parse unified diff from response
   * 4. Apply diff to file via DiffApplier
   * 5. Commit via GitManager
   *
   * @returns ExecutionResult with diff and commitHash
   */
  execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult>;
}

export interface IDiffApplier {
  /**
   * Applies a unified diff to a file.
   *
   * Parses the diff format:
   * - @@ -start,count +start,count @@
   * - Lines starting with - are removed
   * - Lines starting with + are added
   * - Context lines (space prefix) must match file content
   *
   * @throws {DiffError} if context lines don't match (file was modified since diff was generated)
   * @throws {DiffError} if diff format is invalid
   * @throws {DiffError} if file doesn't exist
   */
  apply(filePath: string, diff: string): Promise<void>;

  /**
   * Generates a unified diff between two strings.
   * Used for creating diffs from before/after content.
   */
  generate(before: string, after: string, filePath: string): string;
}

export interface IValidator {
  /**
   * Validates changed files by running project's type checker and linter.
   *
   * Checks (in order, skips if tool not present):
   * 1. TypeScript: tsc --noEmit (if tsconfig.json exists)
   * 2. ESLint: eslint {files} (if .eslintrc* exists)
   * 3. Build: runs build command from package.json (if exists, timeout 30s)
   *
   * @returns ValidationResult. valid=true if all checks pass.
   */
  validate(projectPath: string, changedFiles: string[]): Promise<ValidationResult>;
}

export class DiffError extends Error {
  constructor(message: string, public readonly filePath?: string) {
    super(message);
    this.name = 'DiffError';
  }
}
