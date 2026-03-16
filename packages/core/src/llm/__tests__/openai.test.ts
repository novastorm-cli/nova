import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderError } from '../../contracts/ILlmClient.js';
import type { Message } from '../../models/index.js';

// Mock the OpenAI SDK before importing the provider
const mockCompletionsCreate = vi.fn();

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

    constructor(_opts: Record<string, unknown>) {}
  }

  (OpenAI as unknown as Record<string, unknown>).APIError = APIError;

  return { default: OpenAI, APIError };
});

const { OpenAIProvider } = await import('../OpenAIProvider.js');
const { APIError } = await import('openai');

describe('OpenAIProvider', () => {
  const API_KEY = 'test-openai-key';
  let provider: InstanceType<typeof OpenAIProvider>;

  const userMessages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider(API_KEY);
  });

  // ── chat() ──────────────────────────────────────────────────

  describe('chat()', () => {
    it('sends correct request format and returns parsed string', async () => {
      mockCompletionsCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hello back!' } }],
      });

      const result = await provider.chat(userMessages);

      expect(result).toBe('Hello back!');
      expect(mockCompletionsCreate).toHaveBeenCalledOnce();

      const args = mockCompletionsCreate.mock.calls[0][0];
      expect(args.messages).toBeDefined();
      expect(args.model).toBeDefined();
      expect(args.max_tokens).toBe(4096);
      expect(args.temperature).toBe(0);
    });

    it('options.model overrides default model', async () => {
      mockCompletionsCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      });

      await provider.chat(userMessages, { model: 'gpt-4-turbo' });

      const args = mockCompletionsCreate.mock.calls[0][0];
      expect(args.model).toBe('gpt-4-turbo');
    });

    it('options.responseFormat="json" adds JSON instruction', async () => {
      mockCompletionsCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"key":"value"}' } }],
      });

      await provider.chat(userMessages, { responseFormat: 'json' });

      const args = mockCompletionsCreate.mock.calls[0][0];
      const allContent = JSON.stringify(args);
      expect(allContent.toLowerCase()).toContain('json');
    });
  });

  // ── chatWithVision() ────────────────────────────────────────

  describe('chatWithVision()', () => {
    it('encodes images as base64 in correct format', async () => {
      const imageBuffer = Buffer.from('fake-png-data');

      mockCompletionsCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'I see an image' } }],
      });

      const result = await provider.chatWithVision(userMessages, [imageBuffer]);

      expect(result).toBe('I see an image');
      const args = mockCompletionsCreate.mock.calls[0][0];
      const bodyStr = JSON.stringify(args);

      expect(bodyStr).toContain(imageBuffer.toString('base64'));
      expect(bodyStr).toContain('base64');
    });
  });

  // ── stream() ────────────────────────────────────────────────

  describe('stream()', () => {
    it('returns AsyncIterable that yields text chunks', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
      ];

      mockCompletionsCreate.mockResolvedValueOnce((async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })());

      const result: string[] = [];
      for await (const chunk of provider.stream(userMessages)) {
        result.push(chunk);
      }

      expect(result).toEqual(['Hello', ' world']);
    });
  });

  // ── Error handling ──────────────────────────────────────────

  describe('error handling', () => {
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

    it('HTTP 429 retries once after 1s then throws ProviderError', async () => {
      mockCompletionsCreate
        .mockRejectedValueOnce(new APIError(429, undefined, 'Rate limited', undefined))
        .mockRejectedValueOnce(new APIError(429, undefined, 'Rate limited', undefined));

      const start = Date.now();

      await expect(provider.chat(userMessages)).rejects.toThrow(ProviderError);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(mockCompletionsCreate).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('HTTP 429 retries once and succeeds on second attempt', async () => {
      mockCompletionsCreate
        .mockRejectedValueOnce(new APIError(429, undefined, 'Rate limited', undefined))
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Success after retry' } }],
        });

      const result = await provider.chat(userMessages);
      expect(result).toBe('Success after retry');
      expect(mockCompletionsCreate).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('HTTP 500 throws ProviderError', async () => {
      mockCompletionsCreate.mockRejectedValueOnce(
        new APIError(500, undefined, 'Server error', undefined),
      );

      await expect(provider.chat(userMessages)).rejects.toThrow(ProviderError);
    });
  });
});
