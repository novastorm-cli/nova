import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderError } from '../../contracts/ILlmClient.js';
import type { Message } from '../../models/index.js';

// Mock the OpenAI SDK before importing the provider
const mockCompletionsCreate = vi.fn();
const capturedOpts: Array<Record<string, unknown>> = [];

vi.mock('openai', () => {
  class APIError extends Error {
    readonly status: number;
    readonly error: unknown;
    readonly headers: unknown;
    constructor(status: number, error: unknown, message: string | undefined, headers: unknown) {
      super(message ?? `API error ${status}`);
      this.status = status;
      this.error = error;
      this.headers = headers;
      this.name = 'APIError';
    }
  }

  class OpenAI {
    chat = {
      completions: {
        create: mockCompletionsCreate,
      },
    };

    readonly baseURL?: string | undefined;

    constructor(opts: Record<string, unknown>) {
      capturedOpts.push(opts);
      this.baseURL = opts.baseURL as string | undefined;
    }
  }

  (OpenAI as unknown as Record<string, unknown>).APIError = APIError;

  return { default: OpenAI, APIError };
});

const { DeepSeekProvider } = await import('../DeepSeekProvider.js');
const { APIError } = await import('openai');

describe('DeepSeekProvider', () => {
  const userMessages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor ─────────────────────────────────────────────

  describe('constructor', () => {
    it('accepts valid model deepseek-v4-pro', () => {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-pro' });
      expect(provider).toBeInstanceOf(DeepSeekProvider);
    });

    it('accepts valid model deepseek-v4-flash', () => {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-flash' });
      expect(provider).toBeInstanceOf(DeepSeekProvider);
    });

    it('defaults model to deepseek-v4-pro when not specified', () => {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' });
      expect(provider).toBeInstanceOf(DeepSeekProvider);
    });

    it('throws ProviderError for unknown model', () => {
      try {
        new DeepSeekProvider({ apiKey: 'sk-test', model: 'gpt-4' });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).message).toContain('Unsupported DeepSeek model');
        expect((e as ProviderError).message).toContain('gpt-4');
        expect((e as ProviderError).message).toContain('deepseek-v4-pro');
        expect((e as ProviderError).message).toContain('deepseek-v4-flash');
      }
    });

    it('uses DeepSeek base URL', () => {
      const provider = new DeepSeekProvider({ apiKey: 'sk-test' });
      // Access the underlying OpenAI client baseURL (protected field)
      const client = (provider as unknown as { client: { baseURL: string } }).client;
      expect(client.baseURL).toBe('https://api.deepseek.com/v1');
    });
  });

  // ── chat() ─────────────────────────────────────────────────

  describe('chat()', () => {
    let provider: InstanceType<typeof DeepSeekProvider>;

    beforeEach(() => {
      provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-flash' });
    });

    it('returns content string from response', async () => {
      mockCompletionsCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hello from DeepSeek!' } }],
      });

      const result = await provider.chat(userMessages);
      expect(result).toEqual({ content: 'Hello from DeepSeek!' });
    });

    it('extracts reasoning_content from response message', async () => {
      mockCompletionsCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'The answer is 42',
              reasoning_content: 'Let me think about this step by step...',
            },
          },
        ],
      });

      const result = await provider.chat(userMessages);
      expect(result).toEqual({
        content: 'The answer is 42',
        reasoningContent: 'Let me think about this step by step...',
      });
      expect(provider.lastReasoningContent).toBe('Let me think about this step by step...');
    });

    it('clears lastReasoningContent when no reasoning_content present', async () => {
      // First set it
      mockCompletionsCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Answer 1',
              reasoning_content: 'Thinking...',
            },
          },
        ],
      });
      await provider.chat(userMessages);
      expect(provider.lastReasoningContent).toBe('Thinking...');

      // Then clear it
      mockCompletionsCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Answer 2' } }],
      });
      await provider.chat(userMessages);
      expect(provider.lastReasoningContent).toBeUndefined();
    });

    it('sends model from options', async () => {
      mockCompletionsCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      });

      await provider.chat(userMessages, { model: 'deepseek-v4-pro' });

      const args = mockCompletionsCreate.mock.calls[0]![0];
      expect(args.model).toBe('deepseek-v4-pro');
    });

    it('throws for unknown model in options', async () => {
      try {
        await provider.chat(userMessages, { model: 'gpt-4' });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).message).toContain('Unsupported DeepSeek model');
        expect((e as ProviderError).message).toContain('gpt-4');
      }
    });

    it('uses default model when options.model is not set', async () => {
      mockCompletionsCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      });

      await provider.chat(userMessages);

      const args = mockCompletionsCreate.mock.calls[0]![0];
      expect(args.model).toBe('deepseek-v4-flash');
    });

    it('sends maxTokens', async () => {
      mockCompletionsCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      });

      await provider.chat(userMessages, { maxTokens: 8 });

      const args = mockCompletionsCreate.mock.calls[0]![0];
      expect(args.max_tokens).toBe(8);
    });
  });

  // ── chatWithVision() ───────────────────────────────────────

  describe('chatWithVision()', () => {
    let provider: InstanceType<typeof DeepSeekProvider>;

    beforeEach(() => {
      provider = new DeepSeekProvider({ apiKey: 'sk-test' });
    });

    it('throws ProviderError with code NO_VISION_SUPPORT', async () => {
      try {
        await provider.chatWithVision(userMessages, [Buffer.from('fake-png')]);
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const pe = e as ProviderError;
        expect(pe.code).toBe('NO_VISION_SUPPORT');
        expect(pe.message).toContain('vision');
      }
    });
  });

  // ── stream() ───────────────────────────────────────────────

  describe('stream()', () => {
    let provider: InstanceType<typeof DeepSeekProvider>;

    beforeEach(() => {
      provider = new DeepSeekProvider({ apiKey: 'sk-test', model: 'deepseek-v4-flash' });
    });

    it('yields content chunks', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
      ];

      mockCompletionsCreate.mockResolvedValueOnce(
        (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })(),
      );

      const result: Array<{ content: string; reasoningContent?: string | undefined }> = [];
      for await (const chunk of provider.stream(userMessages)) {
        result.push(chunk);
      }

      expect(result).toEqual([{ content: 'Hello' }, { content: ' world' }]);
    });

    it('captures delta.reasoning_content and stores on lastReasoningContent', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Hi', reasoning_content: 'I should greet' } }] },
        { choices: [{ delta: { content: ' there', reasoning_content: ' the user' } }] },
        { choices: [{ delta: { content: '!' } }] },
      ];

      mockCompletionsCreate.mockResolvedValueOnce(
        (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })(),
      );

      const result: Array<{ content: string; reasoningContent?: string | undefined }> = [];
      for await (const chunk of provider.stream(userMessages)) {
        result.push(chunk);
      }

      expect(result).toEqual([
        { content: 'Hi', reasoningContent: 'I should greet' },
        { content: ' there', reasoningContent: ' the user' },
        { content: '!' },
      ]);
      expect(provider.lastReasoningContent).toBe('I should greet the user');
    });

    it('handles stream chunks without delta gracefully', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{}] },
        { choices: [{ delta: { content: ' world' } }] },
      ];

      mockCompletionsCreate.mockResolvedValueOnce(
        (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })(),
      );

      const result: Array<{ content: string; reasoningContent?: string | undefined }> = [];
      for await (const chunk of provider.stream(userMessages)) {
        result.push(chunk);
      }

      expect(result).toEqual([{ content: 'Hello' }, { content: ' world' }]);
    });

    it('handles reasoning_content without content (reasoning-only chunks)', async () => {
      const chunks = [
        { choices: [{ delta: { reasoning_content: 'Step 1: analyze' } }] },
        { choices: [{ delta: { reasoning_content: 'Step 2: conclude' } }] },
        { choices: [{ delta: { content: 'Answer' } }] },
      ];

      mockCompletionsCreate.mockResolvedValueOnce(
        (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })(),
      );

      const result: Array<{ content: string; reasoningContent?: string | undefined }> = [];
      for await (const chunk of provider.stream(userMessages)) {
        result.push(chunk);
      }

      expect(result).toEqual([
        { content: '', reasoningContent: 'Step 1: analyze' },
        { content: '', reasoningContent: 'Step 2: conclude' },
        { content: 'Answer' },
      ]);
      expect(provider.lastReasoningContent).toBe('Step 1: analyzeStep 2: conclude');
    });

    it('throws for unknown model in options during stream', async () => {
      try {
        const gen = provider.stream(userMessages, { model: 'gpt-4' });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of gen) {
          // should not reach here
        }
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).message).toContain('Unsupported DeepSeek model');
      }
    });
  });

  // ── Error handling ─────────────────────────────────────────

  describe('error handling', () => {
    let provider: InstanceType<typeof DeepSeekProvider>;

    beforeEach(() => {
      provider = new DeepSeekProvider({ apiKey: 'sk-test' });
    });

    it('HTTP 401 throws ProviderError with statusCode=401', async () => {
      mockCompletionsCreate.mockRejectedValueOnce(
        new APIError(401, undefined, 'Invalid API key', undefined),
      );

      try {
        await provider.chat(userMessages);
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).statusCode).toBe(401);
      }
    });

    it('HTTP 429 retries (maxAttempts=4, 3 retries) then throws ProviderError', async () => {
      mockCompletionsCreate
        .mockRejectedValueOnce(new APIError(429, undefined, 'Rate limited', undefined))
        .mockRejectedValueOnce(new APIError(429, undefined, 'Rate limited', undefined))
        .mockRejectedValueOnce(new APIError(429, undefined, 'Rate limited', undefined))
        .mockRejectedValueOnce(new APIError(429, undefined, 'Rate limited', undefined));

      const start = Date.now();

      await expect(provider.chat(userMessages)).rejects.toThrow(ProviderError);

      const elapsed = Date.now() - start;
      // 3 retries: 1s + 2s + 4s ≈ 7s
      expect(elapsed).toBeGreaterThanOrEqual(6000);
      expect(mockCompletionsCreate).toHaveBeenCalledTimes(4);
    }, 15_000);

    it('HTTP 429 retries once and succeeds on second attempt', async () => {
      mockCompletionsCreate
        .mockRejectedValueOnce(new APIError(429, undefined, 'Rate limited', undefined))
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Success after retry' } }],
        });

      const result = await provider.chat(userMessages);
      expect(result).toEqual({ content: 'Success after retry' });
      expect(mockCompletionsCreate).toHaveBeenCalledTimes(2);
    }, 10_000);
  });
});
