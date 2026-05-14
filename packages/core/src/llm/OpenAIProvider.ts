import OpenAI from 'openai';
import type { ChatResponse, LlmOptions, Message, StreamChunk } from '../models/types.js';
import { ProviderError } from '../contracts/ILlmClient.js';
import { BaseProvider } from './BaseProvider.js';

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;

export class OpenAIProvider extends BaseProvider {
  protected readonly providerName: string;
  protected readonly client: OpenAI;
  protected readonly defaultModel: string;

  constructor(
    apiKey: string,
    baseURL?: string,
    providerName = 'openai',
    defaultModel = DEFAULT_MODEL,
  ) {
    super();
    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    this.providerName = providerName;
    this.defaultModel = defaultModel;
  }

  // ── formatRequest ──────────────────────────────────────────

  protected formatRequest(
    messages: Message[],
    options?: LlmOptions,
  ): OpenAI.ChatCompletionCreateParamsNonStreaming {
    const jsonMode = options?.responseFormat === 'json';
    return {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      messages: this.buildMessages(messages, jsonMode),
      ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    };
  }

  // ── formatStreamRequest ────────────────────────────────────

  protected formatStreamRequest(
    messages: Message[],
    options?: LlmOptions,
  ): OpenAI.ChatCompletionCreateParamsStreaming {
    const jsonMode = options?.responseFormat === 'json';
    return {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      messages: this.buildMessages(messages, jsonMode),
      stream: true,
      ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    };
  }

  // ── formatVisionRequest ────────────────────────────────────

  protected formatVisionRequest(
    messages: Message[],
    images: Buffer[],
    options?: LlmOptions,
  ): OpenAI.ChatCompletionCreateParamsNonStreaming {
    const jsonMode = options?.responseFormat === 'json';
    const lastUserIdx = this.findLastUserIndex(messages);
    if (lastUserIdx === -1) {
      throw new ProviderError(
        'No user message found for vision request',
        undefined,
        this.providerName,
      );
    }

    const imageParts: OpenAI.ChatCompletionContentPartImage[] = images.map((img) => ({
      type: 'image_url' as const,
      image_url: {
        url: `data:image/png;base64,${img.toString('base64')}`,
      },
    }));

    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map((m, i) => {
      if (i === lastUserIdx) {
        const textContent = this.toJsonMode(m.content, jsonMode);
        return {
          role: m.role as 'user',
          content: [{ type: 'text' as const, text: textContent }, ...imageParts],
        };
      }
      const content = this.toJsonMode(m.content, jsonMode && m.role === 'user');
      return { role: m.role, content };
    });

    return {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      messages: openaiMessages,
      ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    };
  }

  // ── doChat / doStream ──────────────────────────────────────

  protected async doChat(request: unknown): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    return this.client.chat.completions.create(
      request as OpenAI.ChatCompletionCreateParamsNonStreaming,
    );
  }

  protected async *doStream(
    request: unknown,
  ): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
    const stream = await this.client.chat.completions.create(
      request as OpenAI.ChatCompletionCreateParamsStreaming,
    );
    for await (const chunk of stream) {
      yield chunk;
    }
  }

  // ── parseResponse / parseStreamChunk ───────────────────────

  protected parseResponse(raw: unknown): ChatResponse {
    const response = raw as OpenAI.Chat.Completions.ChatCompletion;
    return { content: response.choices[0]?.message?.content ?? '' };
  }

  protected parseStreamChunk(raw: unknown): StreamChunk | null {
    const chunk = raw as OpenAI.Chat.Completions.ChatCompletionChunk;
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      return { content: delta };
    }
    return null;
  }

  // ── Error classification ───────────────────────────────────

  protected isRetryable(err: unknown): boolean {
    return err instanceof OpenAI.APIError && err.status === 429;
  }

  protected isAbort(err: unknown): boolean {
    if (!(err instanceof OpenAI.APIError)) return false;
    return err.status === 401;
  }

  protected toProviderError(err: unknown): never {
    if (err instanceof ProviderError) throw err;

    if (err instanceof OpenAI.APIError) {
      throw new ProviderError(err.message, Number(err.status), this.providerName);
    }

    throw new ProviderError(
      err instanceof Error ? err.message : String(err),
      undefined,
      this.providerName,
    );
  }

  // ── buildMessages helper ───────────────────────────────────

  protected buildMessages(
    messages: Message[],
    jsonMode: boolean,
  ): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      const content = this.toJsonMode(m.content, jsonMode && m.role === 'user');
      return { role: m.role, content };
    });
  }
}
