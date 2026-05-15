import type { ChatResponse, LlmOptions, Message, StreamChunk } from '../models/types.js';
import { ProviderError } from '../contracts/ILlmClient.js';
import { BaseProvider } from './BaseProvider.js';

const DEFAULT_MODEL = 'llama3';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;
const OLLAMA_BASE_URL = 'http://localhost:11434';

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

export class OllamaProvider extends BaseProvider {
  protected readonly providerName = 'ollama';
  private readonly baseUrl: string;

  constructor(baseUrl = OLLAMA_BASE_URL) {
    super();
    this.baseUrl = baseUrl;
  }

  // ── formatRequest ──────────────────────────────────────────

  protected formatRequest(messages: Message[], options?: LlmOptions): OllamaChatRequest {
    const jsonMode = options?.responseFormat === 'json';
    return {
      model: options?.model ?? DEFAULT_MODEL,
      messages: this.toOllamaMessages(messages, jsonMode),
      stream: false,
      options: {
        num_predict: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      },
      ...(jsonMode ? { format: 'json' } : {}),
    };
  }

  // ── formatStreamRequest ────────────────────────────────────

  protected formatStreamRequest(messages: Message[], options?: LlmOptions): OllamaChatRequest {
    const jsonMode = options?.responseFormat === 'json';
    return {
      model: options?.model ?? DEFAULT_MODEL,
      messages: this.toOllamaMessages(messages, jsonMode),
      stream: true,
      options: {
        num_predict: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      },
      ...(jsonMode ? { format: 'json' } : {}),
    };
  }

  // ── formatVisionRequest ────────────────────────────────────

  protected formatVisionRequest(
    messages: Message[],
    images: Buffer[],
    options?: LlmOptions,
  ): OllamaChatRequest {
    const jsonMode = options?.responseFormat === 'json';
    const ollamaMessages = this.toOllamaMessages(messages, jsonMode);

    const lastUserIdx = this.findLastUserIndex(messages);
    if (lastUserIdx === -1) {
      throw new ProviderError(
        'No user message found for vision request',
        undefined,
        this.providerName,
      );
    }

    ollamaMessages[lastUserIdx]!.images = images.map((img) => img.toString('base64'));

    return {
      model: options?.model ?? DEFAULT_MODEL,
      messages: ollamaMessages,
      stream: false,
      options: {
        num_predict: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      },
      ...(jsonMode ? { format: 'json' } : {}),
    };
  }

  // ── doChat / doStream ──────────────────────────────────────

  protected async doChat(request: unknown): Promise<OllamaChatResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ProviderError(
        `Ollama API error (${response.status}): ${body}`,
        response.status,
        this.providerName,
      );
    }

    return (await response.json()) as OllamaChatResponse;
  }

  protected async *doStream(request: unknown): AsyncIterable<OllamaStreamChunk> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ProviderError(
        `Ollama API error (${response.status}): ${body}`,
        response.status,
        this.providerName,
      );
    }

    if (!response.body) {
      throw new ProviderError('No response body for streaming', undefined, this.providerName);
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
          yield chunk;
        }
      }

      if (buffer.trim()) {
        const chunk = JSON.parse(buffer) as OllamaStreamChunk;
        yield chunk;
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── parseResponse / parseStreamChunk ───────────────────────

  protected parseResponse(raw: unknown): ChatResponse {
    const data = raw as OllamaChatResponse;
    return { content: data.message.content };
  }

  protected parseStreamChunk(raw: unknown): StreamChunk | null {
    const chunk = raw as OllamaStreamChunk;
    if (chunk.message.content) {
      return { content: chunk.message.content };
    }
    return null;
  }

  // ── Error classification ───────────────────────────────────

  protected isRetryable(err: unknown): boolean {
    return err instanceof ProviderError && err.statusCode === 429;
  }

  protected isAbort(err: unknown): boolean {
    if (!(err instanceof ProviderError)) return false;
    return err.statusCode === 401;
  }

  protected toProviderError(err: unknown): never {
    if (err instanceof ProviderError) throw err;

    throw new ProviderError(
      err instanceof Error ? err.message : String(err),
      undefined,
      this.providerName,
    );
  }

  // ── Helpers ────────────────────────────────────────────────

  private toOllamaMessages(messages: Message[], jsonMode: boolean): OllamaMessage[] {
    return messages.map((m) => ({
      role: m.role,
      content: this.toJsonMode(m.content, jsonMode && m.role === 'user'),
    }));
  }
}
