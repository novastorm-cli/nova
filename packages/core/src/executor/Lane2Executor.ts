import { join } from 'node:path';
import type { ILane2Executor } from '../contracts/IExecutor.js';
import type { IGitManager } from '../contracts/IGitManager.js';
import type { TaskItem, ProjectMap, ExecutionResult, LlmClient, MiniContext } from '../models/types.js';
import { DiffApplier } from './DiffApplier.js';

const SYSTEM_PROMPT = `You are a code editor. You receive a file and a modification request.
Respond with ONLY a unified diff (no explanation, no markdown fences).
The diff must be valid unified diff format starting with --- and +++ headers.`;

function buildUserPrompt(context: MiniContext, taskDescription: string): string {
  return `File: ${context.filePath}

${context.importedTypes ? `Imported types:\n${context.importedTypes}\n\n` : ''}Current content:
\`\`\`
${context.content}
\`\`\`

Modification: ${taskDescription}

Respond with ONLY the unified diff.`;
}

/**
 * Extracts a unified diff from an LLM response.
 * Handles cases where the LLM wraps the diff in markdown fences.
 */
function extractDiff(response: string): string {
  // Strip markdown fences if present
  const fencePattern = /```(?:diff)?\n([\s\S]*?)```/;
  const fenceMatch = fencePattern.exec(response);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Look for diff starting with --- or @@
  const lines = response.split('\n');
  const startIdx = lines.findIndex(
    (line) => line.startsWith('---') || line.startsWith('@@'),
  );

  if (startIdx >= 0) {
    return lines.slice(startIdx).join('\n').trim();
  }

  // Return as-is and let DiffApplier validate
  return response.trim();
}

export class Lane2Executor implements ILane2Executor {
  private readonly diffApplier: DiffApplier;

  constructor(
    private readonly projectPath: string,
    private readonly llmClient: LlmClient,
    private readonly gitManager: IGitManager,
  ) {
    this.diffApplier = new DiffApplier();
  }

  async execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult> {
    try {
      const targetFile = task.files[0];
      if (!targetFile) {
        return {
          success: false,
          taskId: task.id,
          error: 'No target file specified for Lane 2 execution',
        };
      }

      // Load mini-context for the target file
      const context = projectMap.fileContexts.get(targetFile);
      if (!context) {
        return {
          success: false,
          taskId: task.id,
          error: `No mini-context available for file: ${targetFile}`,
        };
      }

      // Call LLM for diff
      const response = await this.llmClient.chat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(context, task.description) },
        ],
        {
          temperature: 0,
          maxTokens: 4096,
        },
      );

      const diff = extractDiff(response);

      // Apply diff to the file on disk
      const absPath = join(this.projectPath, targetFile);
      await this.diffApplier.apply(absPath, diff);

      // Commit changes
      const commitHash = await this.gitManager.commit(
        `nova: ${task.description}`,
        [targetFile],
      );

      return {
        success: true,
        taskId: task.id,
        diff,
        commitHash,
      };
    } catch (error: unknown) {
      return {
        success: false,
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
