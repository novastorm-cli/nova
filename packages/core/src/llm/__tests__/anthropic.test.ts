import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderError } from '../../contracts/ILlmClient.js';
import type { Message } from '../../models/index.js';

// Mock the Anthropic SDK before importing the provider
const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
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

  class Anthropic {
    messages = {
      create: mockCreate,
      stream: mockStream,
    };

    constructor(_opts: Record<string, unknown>) {}
  }

  // Attach APIError as a static property
  (Anthropic as unknown as Record<string, unknown>).APIError = APIError;

  return { default: Anthropic, APIError };
});

// Dynamic import after mock is set up
const { AnthropicProvider } = await import('../AnthropicProvider.js');
const AnthropicSDK = (await import('@anthropic-ai/sdk')).default;
const { APIError } = await import('@anthropic-ai/sdk');

describe('AnthropicProvider', () => {
  const API_KEY = 'test-anthropic-key';
  let provider: InstanceType<typeof AnthropicProvider>;

  const userMessages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider(API_KEY);
  });

  // ── chat() ──────────────────────────────────────────────────

  describe('chat()', () => {
    it('sends correct request and returns parsed string', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hello back!' }],
      });

      const result = await provider.chat(userMessages);

      expect(result).toBe('Hello back!');
      expect(mockCreate).toHaveBeenCalledOnce();

      const args = mockCreate.mock.calls[0][0];
      expect(args.messages).toBeDefined();
      expect(args.max_tokens).toBe(4096);
      expect(args.temperature).toBe(0);
      expect(args.system).toBe('You are a helpful assistant.');
      // System message should be extracted, not in messages array
      expect(args.messages.every((m: { role: string }) => m.role !== 'system')).toBe(true);
    });

    it('options.model overrides default model', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
      });

      await provider.chat(userMessages, { model: 'claude-3-haiku-20240307' });

      const args = mockCreate.mock.calls[0][0];
      expect(args.model).toBe('claude-3-haiku-20240307');
    });

    it('options.responseFormat="json" adds JSON instruction', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"key":"value"}' }],
      });

      await provider.chat(userMessages, { responseFormat: 'json' });

      const args = mockCreate.mock.calls[0][0];
      const allContent = JSON.stringify(args.messages);
      expect(allContent.toLowerCase()).toContain('json');
    });
  });

  // ── chatWithVision() ────────────────────────────────────────

  describe('chatWithVision()', () => {
    it('encodes images as base64 in correct format', async () => {
      const imageBuffer = Buffer.from('fake-png-data');

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'I see an image' }],
      });

      const result = await provider.chatWithVision(userMessages, [imageBuffer]);

      expect(result).toBe('I see an image');
      const args = mockCreate.mock.calls[0][0];
      const bodyStr = JSON.stringify(args);

      expect(bodyStr).toContain(imageBuffer.toString('base64'));
      expect(bodyStr).toContain('base64');
      expect(bodyStr).toContain('image/png');
    });
  });

  // ── stream() ────────────────────────────────────────────────

  describe('stream()', () => {
    it('returns AsyncIterable that yields text chunks', async () => {
      const events = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
        { type: 'message_stop' },
      ];

      mockStream.mockReturnValueOnce((async function* () {
        for (const event of events) {
          yield event;
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
      mockCreate.mockRejectedValueOnce(
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
      mockCreate
        .mockRejectedValueOnce(new APIError(429, undefined, 'Rate limited', undefined))
        .mockRejectedValueOnce(new APIError(429, undefined, 'Rate limited', undefined));

      const start = Date.now();

      await expect(provider.chat(userMessages)).rejects.toThrow(ProviderError);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('HTTP 429 retries once and succeeds on second attempt', async () => {
      mockCreate
        .mockRejectedValueOnce(new APIError(429, undefined, 'Rate limited', undefined))
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Success after retry' }],
        });

      const result = await provider.chat(userMessages);
      expect(result).toBe('Success after retry');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('HTTP 500 throws ProviderError', async () => {
      mockCreate.mockRejectedValueOnce(
        new APIError(500, undefined, 'Server error', undefined),
      );

      await expect(provider.chat(userMessages)).rejects.toThrow(ProviderError);
    });
  });
});
