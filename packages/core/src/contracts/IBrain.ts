import type { Observation, ProjectMap, TaskItem, Message } from '../models/types.js';

export interface IBrain {
  /**
   * Analyzes an observation (screenshot + voice + click) and produces actionable tasks.
   *
   * Process:
   * 1. Matches currentUrl to known route → loads relevant file contexts
   * 2. Builds multimodal prompt (screenshot + transcript + project context)
   * 3. Sends to LLM via chatWithVision
   * 4. Parses JSON response into TaskItem[]
   * 5. Classifies each task → assigns lane
   *
   * @returns array of TaskItems with lanes assigned
   * @throws {BrainError} if LLM returns unparseable response after 2 retries
   */
  analyze(observation: Observation, projectMap: ProjectMap): Promise<TaskItem[]>;
}

export interface ITaskDecomposer {
  /**
   * Breaks a complex task (Lane 3+) into smaller subtasks (Lane 1-2 each).
   *
   * Sends task description + project context to LLM.
   * Each subtask gets its own file list and lane assignment.
   *
   * @returns array of subtasks. If task is already simple → returns [task] unchanged.
   */
  decompose(task: TaskItem, projectMap: ProjectMap): Promise<TaskItem[]>;
}

export interface IPromptBuilder {
  /**
   * Builds the analysis prompt for the Brain.
   * Includes: system instructions, screenshot placeholder, transcript, DOM snapshot, project context.
   * Screenshot is NOT included in messages — it's passed separately to chatWithVision.
   */
  buildAnalysisPrompt(observation: Observation, projectMap: ProjectMap): Message[];

  /**
   * Builds the decomposition prompt for TaskDecomposer.
   * Includes: task description, affected files, project context.
   */
  buildDecomposePrompt(task: TaskItem, projectMap: ProjectMap): Message[];
}

export interface ILaneClassifier {
  /**
   * Classifies a task into a speed lane (1-4) based on description and affected files.
   * Pure rule-based, no LLM. Must complete in < 1ms.
   *
   * Rules (checked in order):
   * 1. Style/text-only keywords + single element → Lane 1
   *    Keywords: color, font, margin, padding, display, visibility, text, label,
   *    placeholder, opacity, border, width, height, gap, radius, background, align
   * 2. Single file affected → Lane 2
   * 3. Multiple files OR keywords: add.*page, new.*endpoint, create.*component → Lane 3
   * 4. Keywords: refactor, migrate, rewrite, redesign, restructure, upgrade → Lane 4
   * 5. Default → Lane 2
   *
   * Special case: "add blue button" is Lane 2 (new element), not Lane 1 (not just style change)
   */
  classify(taskDescription: string, affectedFiles: string[]): 1 | 2 | 3 | 4;
}

export class BrainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrainError';
  }
}
