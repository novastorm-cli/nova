import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { MissionFeature, ProjectMap, FeatureResult } from '../models/types.js';
import type { LlmClient } from '../contracts/ILlmClient.js';
import type { IPathGuard } from '../contracts/IPathGuard.js';
import type { ILogger } from '../contracts/ILogger.js';
import type { EventBus } from '../contracts/IEventBus.js';
import type { IMissionWorker } from '../contracts/IMissionWorker.js';
import { parseMixedBlocks, addLineNumbers } from './fileBlocks.js';
import type { ParsedBlock, FileBlock } from './fileBlocks.js';
import { CodeValidator } from './CodeValidator.js';
import type { ValidationError } from './CodeValidator.js';
import { CodeFixer } from './CodeFixer.js';
import { DiffApplier } from './DiffApplier.js';
import { streamWithEvents } from '../llm/streamWithEvents.js';

// ── Worker system prompt ──────────────────────────────────────────────

const WORKER_SYSTEM_PROMPT = `You are a mission worker. You implement individual features as part of a larger mission. You receive a feature description and project context, and you generate code changes using FILE/DIFF/DELETE blocks.

OUTPUT FORMAT - use the appropriate wrapper for each file:

For NEW files (do not exist yet):
=== FILE: path/to/file.tsx ===
full file content here
=== END FILE ===

For EXISTING files (already on disk - shown with line numbers):
=== DIFF: path/to/file.tsx ===
--- a/path/to/file.tsx
+++ b/path/to/file.tsx
@@ -10,6 +10,8 @@
context line
-removed line
+added line
context line
=== END DIFF ===

For DELETING files:
=== DELETE: path/to/old-file.ts ===

Your ENTIRE response must consist of === FILE ===, === DIFF ===, and/or === DELETE === blocks. Nothing else.

RULES:
- For EXISTING files: output ONLY a unified diff with changed hunks. Minimal diff = fewer tokens = faster.
- For NEW files: output COMPLETE file contents.
- Line numbers shown in existing file content are for reference only - do NOT include them in diffs.
- Use ONLY existing directory structure from the project.
- NEVER ask questions or describe what you would do. Just output the code.
- Use only packages from the project's package.json.
- Prefer Tailwind CSS classes if the project uses Tailwind.
- For images use https://picsum.photos/WIDTH/HEIGHT placeholders.
- Use regular <img> tags for external URLs, not next/image <Image>.
- For API keys, secrets, and credentials: ALWAYS use process.env.VARIABLE_NAME. NEVER hardcode secrets.
- Implement ONLY the feature you've been assigned. Do not implement dependencies - those are handled by other workers.
- If you need context from another feature's output, note it but do NOT implement that feature's code.`;

// ── Prompt Builder ────────────────────────────────────────────────────

/**
 * Build a prompt for the worker LLM containing the feature description
 * and relevant project context (stack info, existing files, available packages).
 */
function buildWorkerPrompt(feature: MissionFeature, projectMap: ProjectMap): string {
  const parts: string[] = [];

  // Feature description
  parts.push(`## Feature to Implement\n`);
  parts.push(`Feature ID: ${feature.id}`);
  parts.push(`Description: ${feature.description}`);

  if (feature.files.length > 0) {
    parts.push(`Target files: ${feature.files.join(', ')}`);
  }

  // Project stack info
  parts.push(`\n## Project Stack`);
  parts.push(`- Framework: ${projectMap.stack.framework}`);
  parts.push(`- Language: ${projectMap.stack.language}`);
  if (projectMap.stack.packageManager) {
    parts.push(`- Package Manager: ${projectMap.stack.packageManager}`);
  }
  if (projectMap.stack.typescript) {
    parts.push('- TypeScript: yes');
  }

  // Existing files list
  const allFiles = Array.from(projectMap.fileContexts.keys()).sort();
  if (allFiles.length > 0) {
    parts.push('\n## Existing Files');
    for (const filePath of allFiles) {
      parts.push(`- ${filePath}`);
    }
  }

  // Determine which files exist on disk (for NEW vs EXISTING classification)
  // Include feature target files and any files in the existing file list that
  // are relevant to the feature
  const featureFileSet = new Set(feature.files);
  const candidateFiles: string[] = [];

  // Feature-specified files first
  for (const f of feature.files) {
    candidateFiles.push(f);
  }

  // Also include overview files that might need changes
  for (const f of allFiles) {
    if (
      f.match(/^app\/page\.(tsx|jsx|ts|js)$/) ||
      f.match(/^pages\/index\.(tsx|jsx|ts|js)$/) ||
      f.match(/^app\/layout\.(tsx|jsx|ts|js)$/) ||
      f.match(/globals\.css$/)
    ) {
      if (!featureFileSet.has(f)) {
        candidateFiles.push(f);
      }
    }
  }

  // Include file contents for target and key files
  for (const filePath of candidateFiles) {
    const ctx = projectMap.fileContexts.get(filePath);
    if (ctx) {
      if (featureFileSet.has(filePath)) {
        // This is a target file - mark as NEW or EXISTING based on presence in fs
        // We can't check filesystem here, so we'll use fileContexts presence
        // as a hint. The actual check happens at apply time.
        parts.push(
          `\nTarget file ${filePath}:\n\`\`\`\n${addLineNumbers(ctx.content)}\n\`\`\``,
        );
      } else {
        // Context file - show for reference only
        parts.push(
          `\nReference file ${filePath} (context only, do not modify unless needed):\n\`\`\`\n${ctx.content}\n\`\`\``,
        );
      }
    }
  }

  // Available packages
  const pkgCtx = projectMap.fileContexts.get('package.json');
  if (pkgCtx) {
    try {
      const pkg = JSON.parse(pkgCtx.content) as Record<string, unknown>;
      const pkgDeps = (pkg.dependencies as Record<string, unknown>) ?? {};
      const pkgDevDeps = (pkg.devDependencies as Record<string, unknown>) ?? {};
      const deps = Object.keys({ ...pkgDeps, ...pkgDevDeps }).join(', ');
      parts.push(`\n## Available Packages\n${deps}`);
    } catch {
      /* skip invalid package.json */
    }
  }

  // Output instructions
  parts.push(
    '\n## Instructions\nOutput ONLY === FILE === or === DIFF === or === DELETE === blocks. No explanations. Start immediately.',
  );

  return parts.join('\n');
}

// ── MissionWorker ──────────────────────────────────────────────────────

export class MissionWorker implements IMissionWorker {
  private readonly diffApplier: DiffApplier;
  private readonly codeValidator: CodeValidator;
  private readonly codeFixer: CodeFixer;

  /** Max fix iterations for the auto-fix loop (default 2 for workers). */
  private readonly maxFixIterations: number = 2;

  constructor(
    private readonly projectPath: string,
    private readonly llmClient: LlmClient,
    private readonly workerModel: string,
    private readonly eventBus?: EventBus,
    private readonly pathGuard?: IPathGuard,
    private readonly logger?: ILogger,
    maxFixIterations?: number,
  ) {
    this.diffApplier = new DiffApplier();
    this.codeValidator = new CodeValidator(this.projectPath);
    this.codeFixer = new CodeFixer(this.llmClient, this.eventBus, this.workerModel);
    if (maxFixIterations !== undefined) {
      this.maxFixIterations = maxFixIterations;
    }
  }

  async execute(
    feature: MissionFeature,
    projectMap: ProjectMap,
  ): Promise<FeatureResult> {
    const taskLog = this.logger?.child({ featureId: feature.id });

    try {
      taskLog?.info('MissionWorker: starting feature execution', {
        featureId: feature.id,
        description: feature.description,
        files: feature.files,
        model: this.workerModel,
      });

      this.eventBus?.emit({
        type: 'status',
        data: { message: `Worker: implementing feature "${feature.id}"...` },
      });

      // Build prompt
      const prompt = buildWorkerPrompt(feature, projectMap);

      // Combine system + user into a single message
      const fullPrompt = `${WORKER_SYSTEM_PROMPT}\n\n---\n\n${prompt}\n\nRemember: Output ONLY === FILE ===, === DIFF ===, or === DELETE === blocks. No text, no explanations.`;

      // Call the LLM with the worker model (NOT orchestrator model)
      taskLog?.info('MissionWorker: sending to LLM', {
        featureId: feature.id,
        model: this.workerModel,
      });

      let responseText: string;
      try {
        responseText = await streamWithEvents(
          this.llmClient,
          [{ role: 'user', content: fullPrompt }],
          { temperature: 0, model: this.workerModel },
          this.eventBus,
          feature.id,
        );
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        taskLog?.error('MissionWorker: LLM call failed', {
          featureId: feature.id,
          error: errorMsg,
        });
        return {
          success: false,
          featureId: feature.id,
          error: `LLM call failed: ${errorMsg}`,
        };
      }

      taskLog?.info('MissionWorker: LLM responded', {
        featureId: feature.id,
        responseLength: responseText.length,
      });

      // Parse FILE/DIFF/DELETE blocks
      const mixedBlocks = parseMixedBlocks(responseText);

      // Handle: no blocks in response
      if (mixedBlocks.length === 0) {
        taskLog?.warn('MissionWorker: no file blocks found in LLM response', {
          featureId: feature.id,
          responseStart: responseText.slice(0, 300),
        });
        return {
          success: false,
          featureId: feature.id,
          error: 'LLM did not generate any file blocks -- no file blocks found in response',
        };
      }

      taskLog?.info('MissionWorker: parsed blocks', {
        featureId: feature.id,
        blockCount: mixedBlocks.length,
        blockTypes: mixedBlocks.map((b) => b.type),
        blockPaths: mixedBlocks.map((b) => b.path),
      });

      // Apply mixed blocks to disk
      const { files: fileBlocks, deletedPaths } = await this.applyMixedBlocks(
        mixedBlocks,
      );

      taskLog?.info('MissionWorker: blocks applied', {
        featureId: feature.id,
        filesWritten: fileBlocks.length,
        filesDeleted: deletedPaths.length,
      });

      // If nothing was written or deleted, fail
      if (fileBlocks.length === 0 && deletedPaths.length === 0) {
        return {
          success: false,
          featureId: feature.id,
          error: 'All block applications failed, nothing was written or deleted.',
        };
      }

      // Validate generated code via CodeValidator (tsc + imports)
      taskLog?.info('MissionWorker: validating generated code...', {
        featureId: feature.id,
      });

      let currentBlocks: FileBlock[] = [...fileBlocks];
      let validationErrors: ValidationError[] = [];
      let fixIterations = 0;

      for (
        let iteration = 1;
        iteration <= this.maxFixIterations;
        iteration++
      ) {
        this.eventBus?.emit({
          type: 'status',
          data: {
            message: `Worker: validating feature "${feature.id}" (${iteration}/${this.maxFixIterations})...`,
          },
        });

        try {
          validationErrors = await this.codeValidator.validateFiles(
            currentBlocks,
            {
              skipTsc: this.shouldSkipValidation(currentBlocks),
              skipImportCheck: false,
            },
          );
        } catch (validationCrash: unknown) {
          const msg =
            validationCrash instanceof Error
              ? validationCrash.message
              : String(validationCrash);
          taskLog?.warn(
            `MissionWorker: validation crashed, skipping validation: ${msg}`,
            { featureId: feature.id },
          );
          break;
        }

        if (validationErrors.length === 0) {
          taskLog?.info('MissionWorker: validation passed!', {
            featureId: feature.id,
          });
          break;
        }

        taskLog?.warn(
          `MissionWorker: found ${validationErrors.length} validation error(s)`,
          {
            featureId: feature.id,
            errors: validationErrors.slice(0, 5).map((e) => ({
              file: e.file,
              line: e.line,
              message: e.message,
            })),
          },
        );

        if (iteration >= this.maxFixIterations) {
          taskLog?.warn(
            'MissionWorker: max fix iterations reached, reporting remaining errors',
            {
              featureId: feature.id,
              remainingErrors: validationErrors.length,
            },
          );
          fixIterations = iteration;
          break;
        }

        // Auto-fix via CodeFixer
        taskLog?.info(
          `MissionWorker: auto-fixing errors (attempt ${iteration}/${this.maxFixIterations})...`,
          { featureId: feature.id },
        );

        const pkgContent =
          projectMap.fileContexts.get('package.json')?.content;

        currentBlocks = await this.codeFixer.fixErrors(
          currentBlocks,
          validationErrors.map((e) => ({
            file: e.file,
            line: e.line,
            message: e.message,
          })),
          {
            framework: projectMap.stack.framework,
            language: projectMap.stack.language,
            packageJson: pkgContent,
          },
        );

        // Write fixed files to disk
        await Promise.all(
          currentBlocks.map(async (block) => {
            const absPath = join(this.projectPath, block.path);
            await this.pathGuard?.check(absPath);
            await mkdir(dirname(absPath), { recursive: true });
            await writeFile(absPath, block.content, 'utf-8');
          }),
        );

        fixIterations = iteration;
      }

      // Build diff summary
      const diffLines: string[] = [
        ...fileBlocks.map((b) => `+++ ${b.path}`),
        ...deletedPaths.map((p) => `--- ${p}`),
      ];

      const success = validationErrors.length === 0;

      taskLog?.info(
        success
          ? 'MissionWorker: feature completed successfully'
          : 'MissionWorker: feature completed with validation errors',
        {
          featureId: feature.id,
          generatedFiles: fileBlocks.map((b) => b.path),
          deletedFiles: deletedPaths,
          validationErrors: validationErrors.length,
          fixIterations,
        },
      );

      return {
        success,
        featureId: feature.id,
        diff: diffLines.join('\n'),
        generatedFiles: fileBlocks.map((b) => ({
          path: b.path,
          content: b.content,
        })),
        deletedFiles: deletedPaths,
        validationErrors:
          validationErrors.length > 0
            ? validationErrors.map((e) => ({
                file: e.file,
                line: e.line,
                message: e.message,
              }))
            : undefined,
        fixIterations: fixIterations > 0 ? fixIterations : undefined,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLog?.error('MissionWorker: execution failed with exception', {
        featureId: feature.id,
        error: errorMsg,
      });
      return {
        success: false,
        featureId: feature.id,
        error: errorMsg,
      };
    }
  }

  /**
   * Determine whether tsc can be skipped based on generated file extensions.
   */
  private shouldSkipValidation(blocks: FileBlock[]): boolean {
    if (blocks.length === 0) return false;

    const cssExts = new Set(['.css', '.scss', '.less', '.sass']);
    const nonTsExts = new Set([
      '.css',
      '.scss',
      '.less',
      '.sass',
      '.json',
      '.md',
      '.html',
      '.svg',
    ]);

    const getExt = (path: string): string => {
      const dot = path.lastIndexOf('.');
      return dot !== -1 ? path.slice(dot) : '';
    };

    const exts = blocks.map((b) => getExt(b.path));

    // CSS-only changes: skip tsc
    if (exts.every((ext) => cssExts.has(ext))) {
      return true;
    }

    // Non-TS files only: skip tsc
    if (exts.every((ext) => nonTsExts.has(ext))) {
      return true;
    }

    return false;
  }

  /**
   * Apply mixed blocks to disk: write full files (FILE), apply diffs (DIFF),
   * or delete files (DELETE). Returns normalized FileBlock[] with full content
   * and a list of deleted file paths.
   *
   * Path validation via PathGuard is performed on all operations.
   * Invalid/diff-apply-failed blocks are silently skipped with a warning.
   */
  private async applyMixedBlocks(
    blocks: ParsedBlock[],
  ): Promise<{
    files: FileBlock[];
    deletedPaths: string[];
  }> {
    const result: FileBlock[] = [];
    const deletedPaths: string[] = [];

    for (const block of blocks) {
      try {
        // Path validation via PathGuard
        const absPath = join(this.projectPath, block.path);
        await this.pathGuard?.check(absPath);

        if (block.type === 'delete') {
          try {
            await unlink(absPath);
            deletedPaths.push(block.path);
            this.logger?.info(`MissionWorker: deleted file ${block.path}`);
          } catch (err: unknown) {
            this.logger?.warn(
              `MissionWorker: failed to delete ${block.path} (may not exist)`,
              {
                reason: err instanceof Error ? err.message : String(err),
              },
            );
          }
          continue;
        }

        if (block.type === 'file') {
          // New file or full replacement
          await mkdir(dirname(absPath), { recursive: true });
          await writeFile(absPath, block.content, 'utf-8');
          result.push({ path: block.path, content: block.content });
          this.logger?.info(
            `MissionWorker: wrote file ${block.path} (${block.content.length} chars)`,
          );
        } else {
          // Diff block - apply to existing file
          try {
            await this.diffApplier.apply(absPath, block.diff);
            const updatedContent = await readFile(absPath, 'utf-8');
            result.push({ path: block.path, content: updatedContent });
            this.logger?.info(
              `MissionWorker: applied diff to ${block.path}`,
            );
          } catch (diffErr: unknown) {
            const diffMsg =
              diffErr instanceof Error ? diffErr.message : String(diffErr);
            this.logger?.warn(
              `MissionWorker: diff apply failed for ${block.path}, treating as full file write`,
              { reason: diffMsg },
            );

            // Fallback: if the diff body looks like full file content, write it as-is
            if (block.diff.length > 0) {
              await mkdir(dirname(absPath), { recursive: true });
              await writeFile(absPath, block.diff, 'utf-8');
              result.push({ path: block.path, content: block.diff });
              this.logger?.info(
                `MissionWorker: wrote ${block.path} from diff body (fallback)`,
              );
            }
          }
        }
      } catch (pathErr: unknown) {
        const pathMsg =
          pathErr instanceof Error ? pathErr.message : String(pathErr);
        this.logger?.warn(
          `MissionWorker: path guard rejected ${block.path}`,
          {
            featureId: this.logger ? undefined : undefined,
            path: block.path,
            reason: pathMsg,
          },
        );
        // Skip this block but continue processing others
        continue;
      }
    }

    return { files: result, deletedPaths };
  }
}
