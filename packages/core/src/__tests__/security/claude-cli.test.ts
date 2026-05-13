import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { SpawnOptions } from 'node:child_process';

// Mock node:child_process — we control spawn, passthrough everything else
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn<(...args: unknown[]) => ReturnType<typeof createMockChild>>(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: mockSpawn,
  };
});

import { ClaudeCliProvider } from '../../llm/ClaudeCliProvider.js';
import { ProviderError } from '../../contracts/ILlmClient.js';
import type { Message } from '../../models/types.js';

/** Create a minimal mock ChildProcess with a Readable stdout (async-iterable) */
function createMockChild(stdoutChunks?: Buffer[], exitCode = 0, stderrText = '') {
  const stdout = new Readable({
    read() {
      // push all chunks then end
      for (const chunk of stdoutChunks ?? []) {
        this.push(chunk);
      }
      this.push(null); // end of stream
    },
  });

  const stderr = new Readable({
    read() {
      if (stderrText) this.push(Buffer.from(stderrText));
      this.push(null);
    },
  });

  const stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };

  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin,
    pid: 12345,
    kill: vi.fn(),
    exitCode: null as number | null,
    signalCode: null as number | null,
  });

  // Simulate close event
  setImmediate(() => {
    child.emit('close', exitCode);
  });

  return child;
}

describe('ClaudeCliProvider', () => {
  let provider: ClaudeCliProvider;

  const userMessages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ClaudeCliProvider();
  });

  // ── chatWithVision() ────────────────────────────────────────

  describe('chatWithVision()', () => {
    it('throws ProviderError with code NO_VISION_SUPPORT', async () => {
      const imageBuffer = Buffer.from('fake-png-data');

      try {
        await provider.chatWithVision(userMessages, [imageBuffer]);
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const pe = e as ProviderError;
        expect(pe.code).toBe('NO_VISION_SUPPORT');
        expect(pe.message).toContain('claude-cli');
        expect(pe.message).toContain('vision');
        expect(pe.provider).toBe('claude-cli');
      }
    });

    it('never silently degrades with screenshot-capture note', async () => {
      const imageBuffer = Buffer.from('fake-png-data');

      try {
        await provider.chatWithVision(userMessages, [imageBuffer]);
        expect.unreachable('Should have thrown');
      } catch (e) {
        const pe = e as ProviderError;
        // VAL-SEC-027: output must NOT contain the silent-degradation phrase
        expect(pe.message).not.toContain('screenshots were captured but cannot be sent');
      }
    });

    it('does not call spawn for chatWithVision (throws immediately)', async () => {
      const imageBuffer = Buffer.from('fake-png-data');

      try {
        await provider.chatWithVision(userMessages, [imageBuffer]);
      } catch {
        // expected
      }

      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  // ── stream() spawn behavior ─────────────────────────────────

  describe('stream()', () => {
    it('spawns "claude" directly, not "sh"', async () => {
      const child = createMockChild([Buffer.from('Hello from claude\n')]);

      mockSpawn.mockReturnValueOnce(child);

      const chunks: string[] = [];
      try {
        for await (const chunk of provider.stream(userMessages)) {
          chunks.push(chunk.content);
        }
      } catch {
        // ignore
      }

      expect(mockSpawn).toHaveBeenCalledOnce();

      const spawnArgs = mockSpawn.mock.calls[0] as [string, string[], SpawnOptions];
      const command = spawnArgs[0];
      const args = spawnArgs[1];
      const options = spawnArgs[2];

      // VAL-SEC-026: must be 'claude', not 'sh'
      expect(command).toBe('claude');
      // No shell wrapper
      expect(command).not.toBe('sh');
      expect(command).not.toBe('/bin/sh');
      expect(command).not.toBe('/bin/bash');

      // Args should NOT contain '-c' or shell strings
      const argsStr = JSON.stringify(args);
      expect(argsStr).not.toContain('-c');

      // Should contain the claude -p flag and --disallowedTools
      expect(args).toContain('-p');
      expect(args).toContain('--disallowedTools');

      // stdio should include 'pipe' for stdin
      expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    });

    it('writes the prompt to stdin and closes it', async () => {
      const child = createMockChild([Buffer.from('Response\n')]);

      mockSpawn.mockReturnValueOnce(child);

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of provider.stream(userMessages)) {
          // consume
        }
      } catch {
        // ignore
      }

      expect(child.stdin.write).toHaveBeenCalled();
      // The written prompt should contain the user message content
      const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string | undefined;
      expect(writtenContent).toContain('Hello');
      expect(writtenContent).toContain('You are a helpful assistant');

      // stdin should be closed after writing
      expect(child.stdin.end).toHaveBeenCalled();
    });

    it('yields text chunks from stdout', async () => {
      const child = createMockChild([Buffer.from('Hello '), Buffer.from('World')]);

      mockSpawn.mockReturnValueOnce(child);

      const chunks: string[] = [];
      for await (const chunk of provider.stream(userMessages)) {
        chunks.push(chunk.content);
      }

      expect(chunks.join('')).toBe('Hello World');
    });

    it('throws ProviderError on non-zero exit code', async () => {
      const child = createMockChild([], 1, 'Error: something went wrong');

      mockSpawn.mockReturnValueOnce(child);

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of provider.stream(userMessages)) {
          // consume
        }
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).provider).toBe('claude-cli');
        expect((e as ProviderError).message).toContain('exited with code 1');
      }
    });

    it('throws ProviderError with ENOENT hint when claude not found', async () => {
      mockSpawn.mockImplementationOnce(() => {
        const err = new Error('spawn claude ENOENT');
        (err as NodeJS.ErrnoException).code = 'ENOENT';
        throw err;
      });

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of provider.stream(userMessages)) {
          // consume
        }
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).message).toContain('not found');
        expect((e as ProviderError).provider).toBe('claude-cli');
      }
    });

    it('does not use temp files (spawns claude with prompt on stdin)', async () => {
      const child = createMockChild([Buffer.from('ok')]);

      mockSpawn.mockReturnValueOnce(child);

      const chunks: string[] = [];
      for await (const chunk of provider.stream(userMessages)) {
        chunks.push(chunk.content);
      }

      expect(chunks.join('')).toBe('ok');
      // spawn was called with 'claude' command (not sh)
      expect(mockSpawn.mock.calls[0][0]).toBe('claude');
    });
  });

  // ── chat() ──────────────────────────────────────────────────

  describe('chat()', () => {
    it('returns concatenated stream chunks', async () => {
      const child = createMockChild([Buffer.from('Part1'), Buffer.from('Part2')]);

      mockSpawn.mockReturnValueOnce(child);

      const result = await provider.chat(userMessages);
      expect(result).toEqual({ content: 'Part1Part2' });
    });

    it('passes responseFormat=json as a suffix instruction on stdin', async () => {
      const child = createMockChild([Buffer.from('{"key":"value"}')]);

      mockSpawn.mockReturnValueOnce(child);

      await provider.chat(userMessages, { responseFormat: 'json' });

      expect(child.stdin.write).toHaveBeenCalled();
      const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string | undefined;
      expect(writtenContent).toContain('JSON');
    });
  });
});
