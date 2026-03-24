import { join } from 'node:path';
import type { ILane2Executor } from '../contracts/IExecutor.js';
import type { IGitManager } from '../contracts/IGitManager.js';
import type { IPathGuard } from '../contracts/IPathGuard.js';
import type { TaskItem, ProjectMap, ExecutionResult, LlmClient, MiniContext } from '../models/types.js';
import { CommitQueue } from '../git/CommitQueue.js';
import { DiffApplier } from './DiffApplier.js';
import { addLineNumbers } from './fileBlocks.js';

const SYSTEM_PROMPT = `You are a code editor. You receive a file with line numbers and a modification request.
The file content has line numbers in the format "N | code" for your reference only.
Respond with ONLY a valid unified diff (no explanation, no markdown fences).
The diff must start with --- and +++ headers followed by @@ hunk headers.
Output ONLY the changed hunks — do NOT repeat unchanged parts of the file.
Minimal diff = fewer tokens = faster. Keep it tight.`;

function buildUserPrompt(context: MiniContext, taskDescription: string): string {
  return `File: ${context.filePath}

${context.importedTypes ? `Imported types:\n${context.importedTypes}\n\n` : ''}Current content (line numbers for reference only — do NOT include them in the diff):
\`\`\`
${addLineNumbers(context.content)}
\`\`\`

Modification: ${taskDescription}

Respond with ONLY the unified diff. Output only changed hunks, not the entire file.`;
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
  private readonly commitQueue: CommitQueue;

  constructor(
    private readonly projectPath: string,
    private readonly llmClient: LlmClient,
    private readonly gitManager: IGitManager,
    private readonly pathGuard?: IPathGuard,
    commitQueue?: CommitQueue,
    private readonly modelName?: string,
  ) {
    this.diffApplier = new DiffApplier();
    this.commitQueue = commitQueue ?? new CommitQueue(this.gitManager);
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
          model: this.modelName,
        },
      );

      const diff = extractDiff(response);

      // Apply diff to the file on disk
      const absPath = join(this.projectPath, targetFile);
      await this.pathGuard?.check(absPath);
      await this.diffApplier.apply(absPath, diff);

      // Commit changes (serialized via queue for parallel safety)
      const commitHash = await this.commitQueue.enqueue(
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
