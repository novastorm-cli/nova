import { describe, it, expect } from 'vitest';
import { CodeFixer, type FixableError, type ProjectContext } from '../CodeFixer.js';
import type { FileBlock } from '../fileBlocks.js';
import type { LlmClient, Message, LlmOptions } from '../../models/types.js';

/**
 * Creates a mock LlmClient that captures the prompt messages and returns a predefined response.
 */
function createMockLlmClient(fixedResponse: string): {
  client: LlmClient;
  capturedMessages: Message[][];
} {
  const capturedMessages: Message[][] = [];

  const client: LlmClient = {
    async chat(messages: Message[], _options?: LlmOptions): Promise<string> {
      capturedMessages.push([...messages]);
      return fixedResponse;
    },
    async chatWithVision(
      messages: Message[],
      _images: Buffer[],
      _options?: LlmOptions,
    ): Promise<string> {
      capturedMessages.push([...messages]);
      return fixedResponse;
    },
    async *stream(
      messages: Message[],
      _options?: LlmOptions,
    ): AsyncIterable<string> {
      capturedMessages.push([...messages]);
      yield fixedResponse;
    },
  };

  return { client, capturedMessages };
}

/** Helper: build a standard LLM response with file blocks. */
function buildFileBlockResponse(files: Array<{ path: string; content: string }>): string {
  return files
    .map((f) => `=== FILE: ${f.path} ===\n${f.content}\n=== END FILE ===`)
    .join('\n\n');
}

function defaultContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    framework: 'next.js',
    language: 'typescript',
    ...overrides,
  };
}

describe('CodeFixer', () => {
  // ── 1. Sends errors + file contents to LLM ──

  describe('sending errors and file contents to LLM', () => {
    it('calls LlmClient.chat with error details and file contents', async () => {
      const fixedCode = buildFileBlockResponse([
        { path: 'src/app.ts', content: 'const x: string = "fixed";' },
      ]);
      const { client, capturedMessages } = createMockLlmClient(fixedCode);

      const fixer = new CodeFixer(client);

      const errors: FixableError[] = [
        { file: 'src/app.ts', line: 1, message: "Type 'number' is not assignable to type 'string'." },
      ];

      const files: FileBlock[] = [
        { path: 'src/app.ts', content: 'const x: string = 42;' },
      ];

      await fixer.fixErrors(files, errors, defaultContext());

      // LLM should have been called exactly once
      expect(capturedMessages.length).toBe(1);

      // The prompt should contain file content
      const allContent = capturedMessages[0].map((m) => m.content).join('\n');
      expect(allContent).toContain('const x: string = 42;');
      expect(allContent).toContain('src/app.ts');
    });
  });

  // ── 2. Parses fixed file blocks from LLM response ──

  describe('parsing fixed file blocks', () => {
    it('returns parsed file blocks from the LLM response', async () => {
      const fixedCode = buildFileBlockResponse([
        { path: 'src/app.ts', content: 'const x: string = "fixed";' },
        { path: 'src/utils.ts', content: 'export function helper() { return 1; }' },
      ]);
      const { client } = createMockLlmClient(fixedCode);
      const fixer = new CodeFixer(client);

      const errors: FixableError[] = [
        { file: 'src/app.ts', line: 1, message: 'type error' },
        { file: 'src/utils.ts', line: 1, message: 'type error' },
      ];
      const files: FileBlock[] = [
        { path: 'src/app.ts', content: 'const x: string = 42;' },
        { path: 'src/utils.ts', content: 'export function helper() { return "wrong"; }' },
      ];

      const result = await fixer.fixErrors(files, errors, defaultContext());

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);

      const appBlock = result.find((b: FileBlock) => b.path === 'src/app.ts');
      expect(appBlock).toBeDefined();
      expect(appBlock!.content).toContain('fixed');

      const utilsBlock = result.find((b: FileBlock) => b.path === 'src/utils.ts');
      expect(utilsBlock).toBeDefined();
      expect(utilsBlock!.content).toContain('helper');
    });
  });

  // ── 3. Merges fixed files with unchanged originals ──

  describe('merging fixed files with originals', () => {
    it('preserves original files unchanged when LLM only fixes a subset', async () => {
      // LLM only returns the broken file, not the ok file
      const fixedCode = buildFileBlockResponse([
        { path: 'src/broken.ts', content: 'const x: string = "fixed";' },
      ]);
      const { client } = createMockLlmClient(fixedCode);
      const fixer = new CodeFixer(client);

      const errors: FixableError[] = [
        { file: 'src/broken.ts', line: 1, message: 'type error' },
      ];
      const files: FileBlock[] = [
        { path: 'src/broken.ts', content: 'const x: string = 42;' },
        { path: 'src/ok.ts', content: 'const y: number = 1;' },
      ];

      const result = await fixer.fixErrors(files, errors, defaultContext());

      // The broken file should have the fixed content
      const brokenBlock = result.find((b: FileBlock) => b.path === 'src/broken.ts');
      expect(brokenBlock).toBeDefined();
      expect(brokenBlock!.content).toContain('fixed');

      // The unchanged file should be preserved with original content
      const okBlock = result.find((b: FileBlock) => b.path === 'src/ok.ts');
      expect(okBlock).toBeDefined();
      expect(okBlock!.content).toBe('const y: number = 1;');
    });
  });

  // ── 4. Prompt contains error messages with file:line format ──

  describe('prompt formatting', () => {
    it('includes error messages in file:line format in the prompt', async () => {
      const fixedCode = buildFileBlockResponse([
        { path: 'src/index.ts', content: 'const a = 1;' },
      ]);
      const { client, capturedMessages } = createMockLlmClient(fixedCode);
      const fixer = new CodeFixer(client);

      const errors: FixableError[] = [
        { file: 'src/index.ts', line: 5, message: "Property 'foo' does not exist on type 'Bar'." },
        { file: 'src/index.ts', line: 12, message: "Cannot find name 'unknown_var'." },
      ];
      const files: FileBlock[] = [
        { path: 'src/index.ts', content: 'const placeholder = true;' },
      ];

      await fixer.fixErrors(files, errors, defaultContext());

      const allContent = capturedMessages[0].map((m) => m.content).join('\n');

      // Should contain file:line references
      expect(allContent).toContain('src/index.ts');
      expect(allContent).toContain(':5');
      expect(allContent).toContain(':12');
      expect(allContent).toContain("Property 'foo' does not exist on type 'Bar'.");
      expect(allContent).toContain("Cannot find name 'unknown_var'.");
    });
  });

  // ── 5. Prompt contains package.json when provided ──

  describe('package.json in prompt', () => {
    it('includes package.json content in the prompt when provided', async () => {
      const fixedCode = buildFileBlockResponse([
        { path: 'src/app.ts', content: 'import lodash from "lodash";' },
      ]);
      const { client, capturedMessages } = createMockLlmClient(fixedCode);
      const fixer = new CodeFixer(client);

      const errors: FixableError[] = [
        { file: 'src/app.ts', line: 1, message: "Cannot find module 'lodash'." },
      ];
      const files: FileBlock[] = [
        { path: 'src/app.ts', content: 'import lodash from "lodash";' },
      ];
      const packageJsonStr = JSON.stringify({
        name: 'my-project',
        dependencies: { react: '^18.0.0' },
      });

      await fixer.fixErrors(
        files,
        errors,
        defaultContext({ packageJson: packageJsonStr }),
      );

      const allContent = capturedMessages[0].map((m) => m.content).join('\n');

      expect(allContent).toContain('package.json');
      expect(allContent).toContain('react');
      expect(allContent).toContain('"^18.0.0"');
    });

    it('does not include dependency content when packageJson is not provided', async () => {
      const fixedCode = buildFileBlockResponse([
        { path: 'src/app.ts', content: 'const x = 1;' },
      ]);
      const { client, capturedMessages } = createMockLlmClient(fixedCode);
      const fixer = new CodeFixer(client);

      const errors: FixableError[] = [
        { file: 'src/app.ts', line: 1, message: 'some error' },
      ];
      const files: FileBlock[] = [
        { path: 'src/app.ts', content: 'const x: string = 42;' },
      ];

      await fixer.fixErrors(files, errors, defaultContext());

      const allContent = capturedMessages[0].map((m) => m.content).join('\n');

      // No dependency versions should appear when packageJson is omitted
      expect(allContent).not.toContain('"^18.0.0"');
    });
  });
});
