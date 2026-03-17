import type { LlmClient, Message } from '../models/types.js';
import type { EventBus } from '../models/events.js';
import type { FileBlock } from './fileBlocks.js';
import { parseFileBlocks } from './fileBlocks.js';
import { streamWithEvents } from '../llm/streamWithEvents.js';

export interface FixableError {
  file: string;
  line?: number;
  message: string;
}

export interface ProjectContext {
  framework: string;
  language: string;
  packageJson?: string;
}

const SYSTEM_PROMPT = `You are a senior developer fixing code errors. You receive files with compilation/validation errors.

Fix ALL errors. Output corrected files using this format:

=== FILE: path/to/file.tsx ===
(complete corrected file content)
=== END FILE ===

RULES:
- Only output files that need changes. Do not output unchanged files.
- Fix all reported errors while preserving the original intent.
- Do NOT add imports for packages not in package.json.
- Use only available dependencies listed in the project context.
- Output ONLY file blocks, no explanations.`;

export class CodeFixer {
  constructor(
    private readonly llmClient: LlmClient,
    private readonly eventBus?: EventBus,
  ) {}

  async fixErrors(
    files: FileBlock[],
    errors: FixableError[],
    context: ProjectContext,
  ): Promise<FileBlock[]> {
    // Combine into single message for Claude CLI compatibility
    const combined = `${SYSTEM_PROMPT}\n\n---\n\n${this.buildUserPrompt(files, errors, context)}\n\nOutput ONLY === FILE: === blocks with fixed code. Start immediately with === FILE:`;
    const messages: Message[] = [
      { role: 'user', content: combined },
    ];

    console.log(`[Nova] Fixer: sending ${errors.length} error(s) to LLM for fixing...`);
    for (const err of errors.slice(0, 5)) {
      console.log(`[Nova]   Fix: ${err.file}${err.line ? ':' + err.line : ''} — ${err.message.slice(0, 100)}`);
    }

    const response = await streamWithEvents(
      this.llmClient,
      messages,
      { temperature: 0, maxTokens: 8192 },
      this.eventBus,
    );

    console.log(`[Nova] Fixer: LLM responded (${response.length} chars)`);

    const fixedBlocks = parseFileBlocks(response);
    console.log(`[Nova] Fixer: ${fixedBlocks.length} file(s) fixed`);
    for (const block of fixedBlocks) {
      console.log(`[Nova]   ~ ${block.path}`);
    }

    // Merge: for files returned by LLM, use fixed content. For others, keep original.
    const fixedMap = new Map(fixedBlocks.map((b) => [b.path, b]));
    return files.map((original) => fixedMap.get(original.path) ?? original);
  }

  private buildUserPrompt(
    files: FileBlock[],
    errors: FixableError[],
    context: ProjectContext,
  ): string {
    const parts: string[] = [];

    parts.push(`Project: ${context.framework} + ${context.language}`);

    if (context.packageJson) {
      parts.push(
        `\nAvailable dependencies (from package.json):\n${context.packageJson}`,
      );
    }

    parts.push('\n--- FILES WITH ERRORS ---\n');

    // Only include files that have errors
    const errorFiles = new Set(errors.map((e) => e.file));
    for (const file of files) {
      if (errorFiles.has(file.path)) {
        parts.push(`=== ${file.path} ===`);
        // Add line numbers for easier reference
        const numbered = file.content
          .split('\n')
          .map((line, i) => `${i + 1}: ${line}`)
          .join('\n');
        parts.push(numbered);
        parts.push('');
      }
    }

    parts.push('--- ERRORS ---\n');
    for (const error of errors) {
      const loc = error.line ? `:${error.line}` : '';
      parts.push(`- ${error.file}${loc} — ${error.message}`);
    }

    return parts.join('\n');
  }
}
