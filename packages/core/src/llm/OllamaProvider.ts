import type { LlmClient, LlmOptions, Message } from '../models/types.js';
import { ProviderError } from '../contracts/ILlmClient.js';

const DEFAULT_MODEL = 'llama3';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;
const RETRY_DELAY_MS = 1000;
const OLLAMA_BASE_URL = 'http://localhost:11434';

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i]!)) return i;
  }
  return -1;
}

interface OllamaMessage {
  role: string;
  content: string;
  images?: string[];
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  options?: {
    num_predict?: number;
    temperature?: number;
  };
  format?: string;
}

interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
  };
}

interface OllamaStreamChunk {
  message: {
    content: string;
  };
  done: boolean;
}

function handleHttpError(status: number, body: string): never {
  throw new ProviderError(
    `Ollama API error (${status}): ${body}`,
    status,
    'ollama',
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OllamaProvider implements LlmClient {
  private readonly baseUrl: string;

  constructor(baseUrl = OLLAMA_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async chat(messages: Message[], options?: LlmOptions): Promise<string> {
    const request = this.buildRequest(messages, options, false);

    return this.executeWithRetry(async () => {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        handleHttpError(response.status, await response.text());
      }

      const data = (await response.json()) as OllamaChatResponse;
      return data.message.content;
    });
  }

  async chatWithVision(
    messages: Message[],
    images: Buffer[],
    options?: LlmOptions,
  ): Promise<string> {
    const ollamaMessages = this.toOllamaMessages(messages, options?.responseFormat === 'json');

    const lastUserIdx = findLastIndex(ollamaMessages, (m) => m.role === 'user');
    if (lastUserIdx === -1) {
      throw new ProviderError('No user message found for vision request', undefined, 'ollama');
    }

    ollamaMessages[lastUserIdx]!.images = images.map((img) => img.toString('base64'));

    const request: OllamaChatRequest = {
      model: options?.model ?? DEFAULT_MODEL,
      messages: ollamaMessages,
      stream: false,
      options: {
        num_predict: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      },
      ...(options?.responseFormat === 'json' ? { format: 'json' } : {}),
    };

    return this.executeWithRetry(async () => {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        handleHttpError(response.status, await response.text());
      }

      const data = (await response.json()) as OllamaChatResponse;
      return data.message.content;
    });
  }

  async *stream(messages: Message[], options?: LlmOptions): AsyncIterable<string> {
    const request = this.buildRequest(messages, options, true);

    yield* this.executeStreamWithRetry(request);
  }

  private buildRequest(
    messages: Message[],
    options: LlmOptions | undefined,
    stream: boolean,
  ): OllamaChatRequest {
    return {
      model: options?.model ?? DEFAULT_MODEL,
      messages: this.toOllamaMessages(messages, options?.responseFormat === 'json'),
      stream,
      options: {
        num_predict: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      },
      ...(options?.responseFormat === 'json' ? { format: 'json' } : {}),
    };
  }

  private toOllamaMessages(messages: Message[], jsonMode: boolean): OllamaMessage[] {
    return messages.map((m) => ({
      role: m.role,
      content: jsonMode && m.role === 'user'
        ? `${m.content}\n\nRespond with valid JSON only.`
        : m.content,
    }));
  }

  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ProviderError) {
        if (err.statusCode === 401) throw err;
        if (err.statusCode === 429) {
          await delay(RETRY_DELAY_MS);
          try {
            return await fn();
          } catch (retryErr) {
            if (retryErr instanceof ProviderError) throw retryErr;
            throw new ProviderError(
              retryErr instanceof Error ? retryErr.message : String(retryErr),
              undefined,
              'ollama',
            );
          }
        }
        throw err;
      }
      throw new ProviderError(
        err instanceof Error ? err.message : String(err),
        undefined,
        'ollama',
      );
    }
  }

  private async *executeStreamWithRetry(
    request: OllamaChatRequest,
  ): AsyncIterable<string> {
    try {
      yield* this.doStream(request);
    } catch (err) {
      if (err instanceof ProviderError) {
        if (err.statusCode === 401) throw err;
        if (err.statusCode === 429) {
          await delay(RETRY_DELAY_MS);
          try {
            yield* this.doStream(request);
          } catch (retryErr) {
            if (retryErr instanceof ProviderError) throw retryErr;
            throw new ProviderError(
              retryErr instanceof Error ? retryErr.message : String(retryErr),
              undefined,
              'ollama',
            );
          }
          return;
        }
        throw err;
      }
      throw new ProviderError(
        err instanceof Error ? err.message : String(err),
        undefined,
        'ollama',
      );
    }
  }

  private async *doStream(request: OllamaChatRequest): AsyncIterable<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      handleHttpError(response.status, await response.text());
    }

    if (!response.body) {
      throw new ProviderError('No response body for streaming', undefined, 'ollama');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const chunk = JSON.parse(line) as OllamaStreamChunk;
          if (chunk.message.content) {
            yield chunk.message.content;
          }
        }
      }

      if (buffer.trim()) {
        const chunk = JSON.parse(buffer) as OllamaStreamChunk;
        if (chunk.message.content) {
          yield chunk.message.content;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
