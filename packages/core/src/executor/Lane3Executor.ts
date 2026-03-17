import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { TaskItem, ProjectMap, ExecutionResult, LlmClient } from '../models/types.js';
import type { IGitManager } from '../contracts/IGitManager.js';
import type { EventBus } from '../models/events.js';
import type { FileBlock } from './fileBlocks.js';
import { parseFileBlocks } from './fileBlocks.js';
import { CodeValidator } from './CodeValidator.js';
import type { ValidationError } from './CodeValidator.js';
import { CodeFixer } from './CodeFixer.js';
import { streamWithEvents } from '../llm/streamWithEvents.js';

const SYSTEM_PROMPT = `You are a code generation tool. You output ONLY code files. No explanations. No questions. No descriptions.

OUTPUT FORMAT (mandatory, no other format allowed):

=== FILE: path/to/file.tsx ===
full file content here
=== END FILE ===

You can output multiple files. Your ENTIRE response must consist of === FILE === blocks. Nothing else.

RULES:
- Use ONLY existing directory structure from the project.
- Output COMPLETE file contents (not diffs, not partial).
- NEVER ask questions or describe what you would do. Just output the code.
- NEVER say "I need permission" or "Here's what I would do". Just output the file blocks.
- Use only packages from the project's package.json.
- Prefer Tailwind CSS classes if the project uses Tailwind.
- For images use https://picsum.photos/WIDTH/HEIGHT placeholders.
- Use regular <img> tags for external URLs, not next/image <Image>.`;

function buildPrompt(task: TaskItem, projectMap: ProjectMap): string {
  const parts = [
    `Project: ${projectMap.stack.framework} + ${projectMap.stack.language}`,
    `Task: ${task.description}`,
  ];

  if (task.files.length > 0) {
    parts.push(`Target files: ${task.files.join(', ')}`);
  }

  // Show full file tree so AI knows the structure
  const allFiles = Array.from(projectMap.fileContexts.keys()).sort();
  parts.push(`\nExisting files in project:\n${allFiles.map(f => `  ${f}`).join('\n')}`);

  parts.push(`\nProject context:\n${projectMap.compressedContext}`);

  // Include key file contents — main page, layout, and any task-relevant files
  const keyFiles = new Set<string>();

  // Always include main entry point
  for (const f of allFiles) {
    if (f.match(/^app\/page\.(tsx|jsx|ts|js)$/) || f.match(/^pages\/index\.(tsx|jsx|ts|js)$/)) {
      keyFiles.add(f);
    }
    if (f.match(/^app\/layout\.(tsx|jsx|ts|js)$/)) {
      keyFiles.add(f);
    }
    if (f.match(/globals\.css$/)) {
      keyFiles.add(f);
    }
  }

  // Add task-specified files
  for (const f of task.files) {
    keyFiles.add(f);
  }

  // Add a few more relevant files
  for (const f of allFiles.slice(0, 3)) {
    keyFiles.add(f);
  }

  for (const filePath of keyFiles) {
    const ctx = projectMap.fileContexts.get(filePath);
    if (ctx) {
      parts.push(`\nExisting file ${filePath}:\n\`\`\`\n${ctx.content}\n\`\`\``);
    }
  }

  // Include package.json deps so AI knows what's available
  const pkgCtx = projectMap.fileContexts.get('package.json');
  if (pkgCtx) {
    parts.push(`\npackage.json (available dependencies):\n\`\`\`\n${pkgCtx.content}\n\`\`\``);
  }

  return parts.join('\n');
}

export class Lane3Executor {
  constructor(
    private readonly projectPath: string,
    private readonly llmClient: LlmClient,
    private readonly gitManager: IGitManager,
    private readonly eventBus?: EventBus,
    private readonly maxFixIterations: number = 3,
  ) {}

  async execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult> {
    try {
      console.log(`[Nova] Developer: task "${task.description}"`);
      console.log(`[Nova] Developer: sending to LLM...`);
      this.eventBus?.emit({ type: 'status', data: { message: `Generating code for: ${task.description.slice(0, 80)}...` } });

      const prompt = buildPrompt(task, projectMap);

      // Combine system + user into single message for Claude CLI compatibility
      const fullPrompt = `${SYSTEM_PROMPT}\n\n---\n\n${prompt}\n\nRemember: Output ONLY === FILE: path === blocks. No text, no explanations. Start immediately with === FILE:`;

      const response = await streamWithEvents(
        this.llmClient,
        [{ role: 'user', content: fullPrompt }],
        { temperature: 0 },
        this.eventBus,
        task.id,
      );

      console.log(`[Nova] Developer: LLM responded (${response.length} chars)`);

      const fileBlocks = parseFileBlocks(response);

      if (fileBlocks.length === 0) {
        console.log(`[Nova] Developer: no file blocks found in response. First 300 chars:`);
        console.log(`[Nova] ${response.slice(0, 300)}`);
        return {
          success: false,
          taskId: task.id,
          error: 'LLM did not generate any file blocks. Response may need different parsing.',
        };
      }

      // DEVELOPER phase done — files generated
      console.log(`[Nova] Developer: generated ${fileBlocks.length} file(s):`);
      for (const block of fileBlocks) {
        console.log(`[Nova]   + ${block.path} (${block.content.length} chars)`);
      }

      // Write initial files
      for (const block of fileBlocks) {
        const absPath = join(this.projectPath, block.path);
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(absPath, block.content, 'utf-8');
      }

      // TESTER/DIRECTOR loop
      const validator = new CodeValidator(this.projectPath);
      const fixer = new CodeFixer(this.llmClient, this.eventBus);
      let currentBlocks: FileBlock[] = [...fileBlocks];
      let errors: ValidationError[] = [];

      for (let iteration = 1; iteration <= this.maxFixIterations; iteration++) {
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

      // Commit all changes
      const commitHash = await this.gitManager.commit(
        `nova: ${task.description}`,
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
}
