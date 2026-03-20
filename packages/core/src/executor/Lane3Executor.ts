import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { TaskItem, ProjectMap, ExecutionResult, LlmClient } from '../models/types.js';
import type { IGitManager } from '../contracts/IGitManager.js';
import type { EventBus } from '../models/events.js';
import type { FileBlock, ParsedBlock } from './fileBlocks.js';
import { parseFileBlocks, parseMixedBlocks, addLineNumbers } from './fileBlocks.js';
import { CodeValidator } from './CodeValidator.js';
import type { ValidationError } from './CodeValidator.js';
import { CodeFixer } from './CodeFixer.js';
import { DiffApplier } from './DiffApplier.js';
import { streamWithEvents } from '../llm/streamWithEvents.js';
import { EnvDetector } from './EnvDetector.js';

const SYSTEM_PROMPT = `You are a code generation tool. You output ONLY code. No explanations. No questions. No descriptions.

OUTPUT FORMAT — use the appropriate wrapper for each file:

For NEW files (do not exist yet):
=== FILE: path/to/file.tsx ===
full file content here
=== END FILE ===

For EXISTING files (already on disk — shown with line numbers):
=== DIFF: path/to/file.tsx ===
--- a/path/to/file.tsx
+++ b/path/to/file.tsx
@@ -10,6 +10,8 @@
 context line
-removed line
+added line
 context line
=== END DIFF ===

Your ENTIRE response must consist of === FILE === and/or === DIFF === blocks. Nothing else.

RULES:
- For EXISTING files: output ONLY a unified diff with changed hunks. Minimal diff = fewer tokens = faster.
- For NEW files: output COMPLETE file contents.
- Line numbers shown in existing file content are for reference only — do NOT include them in diffs.
- Use ONLY existing directory structure from the project.
- NEVER ask questions or describe what you would do. Just output the code.
- Use only packages from the project's package.json.
- Prefer Tailwind CSS classes if the project uses Tailwind.
- For images use https://picsum.photos/WIDTH/HEIGHT placeholders.
- Use regular <img> tags for external URLs, not next/image <Image>.
- For API keys, secrets, and credentials: ALWAYS use process.env.VARIABLE_NAME. NEVER hardcode secrets. Use descriptive names like RESEND_API_KEY, STRIPE_SECRET_KEY, DATABASE_URL.`;

function buildPrompt(task: TaskItem, projectMap: ProjectMap, existingFiles: Set<string>): string {
  const parts = [
    `Project: ${projectMap.stack.framework} + ${projectMap.stack.language}`,
    `Task: ${task.description}`,
  ];

  if (task.files.length > 0) {
    parts.push(`Target files: ${task.files.join(', ')}`);
  }

  const allFiles = Array.from(projectMap.fileContexts.keys()).sort();
  parts.push(`\nExisting files: ${allFiles.join(', ')}`);

  // Only include task-relevant files (keep prompt small for speed)
  const keyFiles = new Set<string>();

  // Task-specified files first
  for (const f of task.files) {
    keyFiles.add(f);
  }

  // If no specific files, include main page only
  if (keyFiles.size === 0) {
    for (const f of allFiles) {
      if (f.match(/^app\/page\.(tsx|jsx|ts|js)$/)) keyFiles.add(f);
    }
  }

  for (const filePath of keyFiles) {
    const ctx = projectMap.fileContexts.get(filePath);
    if (ctx) {
      if (existingFiles.has(filePath)) {
        // Existing file: show with line numbers so LLM can produce accurate diffs
        parts.push(`\nExisting file ${filePath} (use === DIFF === for changes):\n\`\`\`\n${addLineNumbers(ctx.content)}\n\`\`\``);
      } else {
        parts.push(`\nNew file ${filePath} (use === FILE === for full content):\n\`\`\`\n${ctx.content}\n\`\`\``);
      }
    }
  }

  // Just list dependency names (not full package.json)
  const pkgCtx = projectMap.fileContexts.get('package.json');
  if (pkgCtx) {
    try {
      const pkg = JSON.parse(pkgCtx.content);
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(', ');
      parts.push(`\nAvailable packages: ${deps}`);
    } catch { /* skip */ }
  }

  return parts.join('\n');
}

export class Lane3Executor {
  private readonly diffApplier: DiffApplier;

  constructor(
    private readonly projectPath: string,
    private readonly llmClient: LlmClient,
    private readonly gitManager: IGitManager,
    private readonly eventBus?: EventBus,
    private readonly maxFixIterations: number = 3,
    private readonly modelName?: string,
  ) {
    this.diffApplier = new DiffApplier();
  }

  async execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult> {
    try {
      console.log(`[Nova] Developer: task "${task.description}"`);
      console.log(`[Nova] Developer: sending to LLM...`);
      this.eventBus?.emit({ type: 'status', data: { message: `Generating code for: ${task.description.slice(0, 80)}...` } });

      // Determine which files already exist on disk.
      // Must cover task.files AND the same key files that buildPrompt will render.
      const allFiles = Array.from(projectMap.fileContexts.keys()).sort();
      const candidateFiles = new Set<string>();

      // Task-specified files
      for (const f of task.files) {
        candidateFiles.add(f);
      }

      // Key files: main page, layout, globals.css (same logic as buildPrompt)
      for (const f of allFiles) {
        if (f.match(/^app\/page\.(tsx|jsx|ts|js)$/) || f.match(/^pages\/index\.(tsx|jsx|ts|js)$/)) {
          candidateFiles.add(f);
        }
        if (f.match(/^app\/layout\.(tsx|jsx|ts|js)$/)) {
          candidateFiles.add(f);
        }
        if (f.match(/globals\.css$/)) {
          candidateFiles.add(f);
        }
      }

      // First 3 files from allFiles (same as buildPrompt)
      for (const f of allFiles.slice(0, 3)) {
        candidateFiles.add(f);
      }

      const existingFiles = new Set<string>();
      for (const filePath of candidateFiles) {
        const absPath = join(this.projectPath, filePath);
        if (existsSync(absPath)) {
          existingFiles.add(filePath);
        }
      }

      const prompt = buildPrompt(task, projectMap, existingFiles);

      // Combine system + user into single message for Claude CLI compatibility
      const fullPrompt = `${SYSTEM_PROMPT}\n\n---\n\n${prompt}\n\nRemember: Output ONLY === FILE === or === DIFF === blocks. No text, no explanations. Start immediately with ===`;

      const response = await streamWithEvents(
        this.llmClient,
        [{ role: 'user', content: fullPrompt }],
        { temperature: 0, model: this.modelName },
        this.eventBus,
        task.id,
      );

      console.log(`[Nova] Developer: LLM responded (${response.length} chars)`);

      // Parse mixed blocks (FILE + DIFF), with fallback to legacy FILE-only parsing
      let mixedBlocks = parseMixedBlocks(response);

      // Fallback: if no mixed blocks found, try legacy FILE-only parsing
      if (mixedBlocks.length === 0) {
        const legacyBlocks = parseFileBlocks(response);
        mixedBlocks = legacyBlocks.map(b => ({ type: 'file' as const, path: b.path, content: b.content }));
      }

      if (mixedBlocks.length === 0) {
        console.log(`[Nova] Developer: no file blocks found in response. First 300 chars:`);
        console.log(`[Nova] ${response.slice(0, 300)}`);
        return {
          success: false,
          taskId: task.id,
          error: 'LLM did not generate any file blocks. Response may need different parsing.',
        };
      }

      // DEVELOPER phase done — files generated
      console.log(`[Nova] Developer: generated ${mixedBlocks.length} block(s):`);
      for (const block of mixedBlocks) {
        if (block.type === 'file') {
          console.log(`[Nova]   + ${block.path} (${block.content.length} chars, full file)`);
        } else {
          console.log(`[Nova]   ~ ${block.path} (${block.diff.length} chars, diff)`);
        }
      }

      // Apply blocks: write full files or apply diffs
      const fileBlocks = await this.applyMixedBlocks(mixedBlocks);

      // Detect missing env vars in generated code (both full files and diffs)
      const envDetector = new EnvDetector();
      const generatedFileContents: string[] = [];
      for (const block of mixedBlocks) {
        if (block.type === 'file') {
          generatedFileContents.push(block.content);
        } else {
          // Extract added lines from diffs (lines starting with +, excluding +++ header)
          const addedLines = block.diff
            .split('\n')
            .filter(line => line.startsWith('+') && !line.startsWith('+++'))
            .map(line => line.substring(1))
            .join('\n');
          if (addedLines) generatedFileContents.push(addedLines);
        }
      }
      const missingVars = envDetector.detectMissing(this.projectPath, generatedFileContents);
      if (missingVars.length > 0 && this.eventBus) {
        this.eventBus.emit({ type: 'secrets_required', data: { envVars: missingVars, taskId: task.id } });
      }

      // TESTER/DIRECTOR loop (skip for single-file small changes to save time)
      const skipValidation = fileBlocks.length === 1 && fileBlocks[0].content.length < 3000;
      const validator = new CodeValidator(this.projectPath);
      const fixer = new CodeFixer(this.llmClient, this.eventBus);
      let currentBlocks: FileBlock[] = [...fileBlocks];
      let errors: ValidationError[] = [];

      if (skipValidation) {
        console.log(`[Nova] Tester: skipping validation (small single-file change)`);
      }

      for (let iteration = 1; !skipValidation && iteration <= this.maxFixIterations; iteration++) {
        // TESTER phase
        console.log(`[Nova] Tester: validating (iteration ${iteration}/${this.maxFixIterations})...`);
        this.eventBus?.emit({ type: 'status', data: { message: `Validating code (${iteration}/${this.maxFixIterations})...` } });

        errors = await validator.validateFiles(currentBlocks);

        if (errors.length === 0) {
          console.log(`[Nova] Tester: all checks passed!`);
          this.eventBus?.emit({ type: 'status', data: { message: 'Code validation passed!' } });
          break;
        }

        console.log(`[Nova] Tester: found ${errors.length} error(s)`);
        for (const err of errors.slice(0, 5)) {
          console.log(`[Nova]   ${err.file}${err.line ? ':' + err.line : ''} — ${err.message}`);
        }

        if (iteration >= this.maxFixIterations) {
          console.log(`[Nova] Director: max iterations reached, committing with warnings`);
          this.eventBus?.emit({ type: 'status', data: { message: `Committing with ${errors.length} remaining warnings` } });
          break;
        }

        // DIRECTOR phase — fix errors
        console.log(`[Nova] Director: requesting fixes (attempt ${iteration}/${this.maxFixIterations})...`);
        this.eventBus?.emit({ type: 'status', data: { message: `Fixing ${errors.length} errors (attempt ${iteration}/${this.maxFixIterations})...` } });

        const pkgContent = projectMap.fileContexts.get('package.json')?.content;
        const fixedBlocks = await fixer.fixErrors(currentBlocks, errors, {
          framework: projectMap.stack.framework,
          language: projectMap.stack.language,
          packageJson: pkgContent,
        });

        // Write fixed files
        for (const block of fixedBlocks) {
          const absPath = join(this.projectPath, block.path);
          await mkdir(dirname(absPath), { recursive: true });
          await writeFile(absPath, block.content, 'utf-8');
        }

        currentBlocks = fixedBlocks;
      }

      // Collect final file list for commit
      const writtenFiles = currentBlocks.map(b => b.path);

      // Commit all changes (sanitize message for git)
      const safeMsg = `nova: ${task.description.replace(/['"\\`$]/g, '').slice(0, 120)}`;
      const commitHash = await this.gitManager.commit(
        safeMsg,
        writtenFiles,
      );

      return {
        success: true,
        taskId: task.id,
        diff: fileBlocks.map((b) => `+++ ${b.path}`).join('\n'),
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

  /**
   * Fuzzy diff apply — find removed lines in the file and replace with added lines.
   * Ignores context lines (doesn't require exact line numbers).
   */
  private fuzzyApplyDiff(content: string, diff: string): string {
    const lines = content.split('\n');
    const diffLines = diff.split('\n');

    // Extract hunks: removed lines (- prefix) and added lines (+ prefix)
    const removals: string[] = [];
    const additions: string[] = [];

    for (const dl of diffLines) {
      if (dl.startsWith('-') && !dl.startsWith('---')) {
        removals.push(dl.slice(1)); // Remove the - prefix
      } else if (dl.startsWith('+') && !dl.startsWith('+++')) {
        additions.push(dl.slice(1)); // Remove the + prefix
      }
    }

    if (removals.length === 0 && additions.length === 0) return content;

    // Find the first removal line in the file
    let result = content;
    if (removals.length > 0) {
      const firstRemoval = removals[0].trim();
      const idx = lines.findIndex(l => l.trim() === firstRemoval);

      if (idx !== -1) {
        // Remove all matched lines and insert additions at that position
        const newLines = [...lines];
        let removeCount = 0;
        for (let i = 0; i < removals.length && (idx + removeCount) < newLines.length; i++) {
          if (newLines[idx + removeCount].trim() === removals[i].trim()) {
            removeCount++;
          }
        }
        newLines.splice(idx, removeCount, ...additions);
        result = newLines.join('\n');
      }
    } else if (additions.length > 0) {
      // Only additions — append at end
      result = content + '\n' + additions.join('\n');
    }

    return result;
  }

  /**
   * Apply mixed blocks: write full files or apply diffs.
   * Returns normalized FileBlock[] (all with full content) for validation.
   */
  private async applyMixedBlocks(blocks: ParsedBlock[]): Promise<FileBlock[]> {
    const result: FileBlock[] = [];

    for (const block of blocks) {
      const absPath = join(this.projectPath, block.path);

      if (block.type === 'file') {
        // New file or full replacement — write directly
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(absPath, block.content, 'utf-8');
        result.push({ path: block.path, content: block.content });
      } else {
        // Diff block — apply to existing file
        try {
          await this.diffApplier.apply(absPath, block.diff);
          const updatedContent = await readFile(absPath, 'utf-8');
          result.push({ path: block.path, content: updatedContent });
        } catch (err) {
          // Diff failed — try fuzzy apply (ignore context lines, just apply +/- changes)
          console.log(`[Nova] Warning: diff apply failed for ${block.path}`);
          console.log(`[Nova]   Reason: ${err instanceof Error ? err.message : String(err)}`);
          console.log(`[Nova]   Trying fuzzy apply...`);

          try {
            const existingContent = await readFile(absPath, 'utf-8');
            const patched = this.fuzzyApplyDiff(existingContent, block.diff);
            if (patched !== existingContent) {
              await writeFile(absPath, patched, 'utf-8');
              result.push({ path: block.path, content: patched });
              console.log(`[Nova]   Fuzzy apply succeeded for ${block.path}`);
            } else {
              console.log(`[Nova]   Fuzzy apply made no changes, keeping file`);
              result.push({ path: block.path, content: existingContent });
            }
          } catch {
            const existingContent = await readFile(absPath, 'utf-8');
            result.push({ path: block.path, content: existingContent });
          }
        }
      }
    }

    return result;
  }
}
