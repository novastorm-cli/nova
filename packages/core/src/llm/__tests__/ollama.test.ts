import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../OllamaProvider.js';
import { ProviderError } from '../../contracts/ILlmClient.js';
import type { Message } from '../../models/index.js';

describe('OllamaProvider', () => {
  let provider: InstanceType<typeof OllamaProvider>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  const userMessages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
  ];

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    provider = new OllamaProvider();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── chat() ──────────────────────────────────────────────────

  describe('chat()', () => {
    it('sends correct HTTP request format (headers, body structure)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: 'Hello back!' },
        }),
      });

      await provider.chat(userMessages);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];

      // Ollama runs on localhost:11434
      expect(url).toContain('localhost:11434');
      expect(url).toContain('/api/chat');
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body);
      expect(body).toHaveProperty('messages');
      expect(body).toHaveProperty('model');
      expect(body.stream).toBe(false);
    });

    it('parses response and returns string', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: 'Parsed response' },
        }),
      });

      const result = await provider.chat(userMessages);
      expect(typeof result).toBe('string');
      expect(result).toBe('Parsed response');
    });

    it('options.model overrides default model', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: 'ok' },
        }),
      });

      await provider.chat(userMessages, { model: 'codellama:13b' });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.model).toBe('codellama:13b');
    });

    it('options.responseFormat="json" adds JSON instruction', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: '{"key":"value"}' },
        }),
      });

      await provider.chat(userMessages, { responseFormat: 'json' });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const allContent = JSON.stringify(body);
      expect(allContent.toLowerCase()).toContain('json');
    });
  });

  // ── chatWithVision() ────────────────────────────────────────

  describe('chatWithVision()', () => {
    it('encodes images as base64 in correct format', async () => {
      const imageBuffer = Buffer.from('fake-png-data');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: 'I see an image' },
        }),
      });

      await provider.chatWithVision(userMessages, [imageBuffer]);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const bodyStr = JSON.stringify(body);

      expect(bodyStr).toContain(imageBuffer.toString('base64'));
    });
  });

  // ── stream() ────────────────────────────────────────────────

  describe('stream()', () => {
    it('returns AsyncIterable that yields text chunks', async () => {
      const encoder = new TextEncoder();
      const lines = [
        '{"message":{"content":"Hello"},"done":false}\n',
        '{"message":{"content":" world"},"done":false}\n',
        '{"message":{"content":""},"done":true}\n',
      ];

      let lineIndex = 0;
      const readableStream = new ReadableStream({
        pull(controller) {
          if (lineIndex < lines.length) {
            controller.enqueue(encoder.encode(lines[lineIndex]!));
            lineIndex++;
          } else {
            controller.close();
          }
        },
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: readableStream,
      });

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
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      try {
        await provider.chat(userMessages);
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        expect((e as ProviderError).statusCode).toBe(401);
      }
    });

    it('HTTP 429 retries once after 1s then throws ProviderError', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => 'Rate limited',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => 'Rate limited',
        });

      const start = Date.now();

      await expect(provider.chat(userMessages)).rejects.toThrow(ProviderError);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('HTTP 429 retries once and succeeds on second attempt', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => 'Rate limited',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            message: { content: 'Success after retry' },
          }),
        });

      const result = await provider.chat(userMessages);
      expect(result).toBe('Success after retry');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('HTTP 500 throws ProviderError', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(provider.chat(userMessages)).rejects.toThrow(ProviderError);
    });
  });
});
