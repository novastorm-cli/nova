import OpenAI from 'openai';
import { BaseProvider } from './BaseProvider.js';
import type { BaseProviderOptions } from './BaseProvider.js';
import { ProviderError } from '../contracts/ILlmClient.js';
import type { ChatResponse, LlmOptions, Message, StreamChunk } from '../models/types.js';
import { streamWithRetry } from './retry.js';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;
const ALLOWED_MODELS = new Set(['deepseek-v4-pro', 'deepseek-v4-flash']);

export interface DeepSeekConfig {
  apiKey: string;
  model?: string;
  /** Options forwarded to BaseProvider (eventBus, fallbackModel, etc.). */
  baseOptions?: BaseProviderOptions;
}

export class DeepSeekProvider extends BaseProvider {
  /** The reasoning_content extracted from the most recent chat or stream call. */
  public lastReasoningContent?: string | undefined;

  protected readonly providerName = 'deepseek';
  protected readonly client: OpenAI;
  protected readonly defaultModel: string;

  constructor(config: DeepSeekConfig) {
    super({
      ...config.baseOptions,
      model: config.model ?? config.baseOptions?.model ?? DEFAULT_MODEL,
    });
    const model = config.model ?? DEFAULT_MODEL;

    if (!ALLOWED_MODELS.has(model)) {
      throw new ProviderError(
        `Unsupported DeepSeek model: "${model}". Allowed models: ${[...ALLOWED_MODELS].join(', ')}`,
        undefined,
        'deepseek',
      );
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: DEEPSEEK_BASE_URL,
    });
    this.defaultModel = model;
  }

  // ── formatRequest ──────────────────────────────────────────

  protected formatRequest(
    messages: Message[],
    options?: LlmOptions,
  ): OpenAI.ChatCompletionCreateParamsNonStreaming {
    if (options?.model && !ALLOWED_MODELS.has(options.model)) {
      throw new ProviderError(
        `Unsupported DeepSeek model: "${options.model}". Allowed models: ${[...ALLOWED_MODELS].join(', ')}`,
        undefined,
        this.providerName,
      );
    }
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
    if (options?.model && !ALLOWED_MODELS.has(options.model)) {
      throw new ProviderError(
        `Unsupported DeepSeek model: "${options.model}". Allowed models: ${[...ALLOWED_MODELS].join(', ')}`,
        undefined,
        this.providerName,
      );
    }
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

  // ── formatVisionRequest (reject) ───────────────────────────

  /* eslint-disable @typescript-eslint/no-unused-vars */
  protected formatVisionRequest(
    _messages: Message[],
    _images: Buffer[],
    _options?: LlmOptions,
  ): never {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    throw new ProviderError(
      'DeepSeek does not support vision. Use a vision-capable provider for visual mode.',
      undefined,
      this.providerName,
      'NO_VISION_SUPPORT',
    );
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

  // ── parseResponse (extract reasoning_content) ──────────────

  protected parseResponse(raw: unknown): ChatResponse {
    const response = raw as OpenAI.Chat.Completions.ChatCompletion;
    const choice = response.choices[0]?.message;
    const content = choice?.content ?? '';

    // Preserve reasoning_content if present (DeepSeek extension)
    const reasoningContent = (choice as unknown as Record<string, unknown> | undefined)?.[
      'reasoning_content'
    ];
    if (typeof reasoningContent === 'string') {
      this.lastReasoningContent = reasoningContent;
      return { content, reasoningContent };
    }

    this.lastReasoningContent = undefined;
    return { content };
  }

  // ── parseStreamChunk (extract delta.reasoning_content) ─────

  protected parseStreamChunk(raw: unknown): StreamChunk | null {
    const chunk = raw as OpenAI.Chat.Completions.ChatCompletionChunk;
    const delta = chunk.choices[0]?.delta;
    if (!delta) return null;

    // Capture reasoning_content from delta (DeepSeek extension)
    const reasoningDelta = (delta as Record<string, unknown>)['reasoning_content'];
    const reasoningStr = typeof reasoningDelta === 'string' ? reasoningDelta : undefined;

    const content = (delta as Record<string, unknown>)['content'];
    const contentStr = typeof content === 'string' ? content : undefined;

    if (contentStr || reasoningStr) {
      return {
        content: contentStr ?? '',
        ...(reasoningStr ? { reasoningContent: reasoningStr } : {}),
      };
    }

    return null;
  }

  // ── stream (override to accumulate reasoning_content) ──────

  async *stream(messages: Message[], options?: LlmOptions): AsyncIterable<StreamChunk> {
    const request = this.formatStreamRequest(messages, options);
    const reasoningParts: string[] = [];

    for await (const rawChunk of streamWithRetry(
      () => this.doStream(request),
      (e) => this.isRetryable(e),
      (e) => this.isAbort(e),
      (e) => this.toProviderError(e),
      this.buildRetryOptions(),
    )) {
      const parsed = this.parseStreamChunk(rawChunk);
      if (parsed) {
        if (parsed.reasoningContent) {
          reasoningParts.push(parsed.reasoningContent);
        }
        yield parsed;
      }
    }

    if (reasoningParts.length > 0) {
      this.lastReasoningContent = reasoningParts.join('');
    }
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

  private buildMessages(
    messages: Message[],
    jsonMode: boolean,
  ): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      const content = this.toJsonMode(m.content, jsonMode && m.role === 'user');
      return { role: m.role, content };
    });
  }
}
