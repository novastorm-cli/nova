import type OpenAI from 'openai';
import { OpenAIProvider } from './OpenAIProvider.js';
import { ProviderError } from '../contracts/ILlmClient.js';
import type { ChatResponse, LlmOptions, Message, StreamChunk } from '../models/types.js';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-pro';
const ALLOWED_MODELS = new Set(['deepseek-v4-pro', 'deepseek-v4-flash']);

export interface DeepSeekConfig {
  apiKey: string;
  model?: string;
}

export class DeepSeekProvider extends OpenAIProvider {
  /** The reasoning_content extracted from the most recent chat or stream call. */
  public lastReasoningContent?: string;

  constructor(config: DeepSeekConfig) {
    const model = config.model ?? DEFAULT_MODEL;

    if (!ALLOWED_MODELS.has(model)) {
      throw new ProviderError(
        `Unsupported DeepSeek model: "${model}". Allowed models: ${[...ALLOWED_MODELS].join(', ')}`,
        undefined,
        'deepseek',
      );
    }

    super(config.apiKey, DEEPSEEK_BASE_URL, 'deepseek', model);
  }

  async chat(messages: Message[], options?: LlmOptions): Promise<ChatResponse> {
    if (options?.model && !ALLOWED_MODELS.has(options.model)) {
      throw new ProviderError(
        `Unsupported DeepSeek model: "${options.model}". Allowed models: ${[...ALLOWED_MODELS].join(', ')}`,
        undefined,
        'deepseek',
      );
    }

    const jsonMode = options?.responseFormat === 'json';
    const request: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0,
      messages: this.buildMessages(messages, jsonMode),
      ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    };

    return this.executeWithRetry(async () => {
      const response = await this.client.chat.completions.create(request);
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
    });
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  chatWithVision(
    _messages: Message[],
    _images: Buffer[],
    _options?: LlmOptions,
  ): Promise<ChatResponse> {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    throw new ProviderError(
      'DeepSeek does not support vision. Use a vision-capable provider for visual mode.',
      undefined,
      'deepseek',
      'NO_VISION_SUPPORT',
    );
  }

  async *stream(messages: Message[], options?: LlmOptions): AsyncIterable<StreamChunk> {
    if (options?.model && !ALLOWED_MODELS.has(options.model)) {
      throw new ProviderError(
        `Unsupported DeepSeek model: "${options.model}". Allowed models: ${[...ALLOWED_MODELS].join(', ')}`,
        undefined,
        'deepseek',
      );
    }

    const jsonMode = options?.responseFormat === 'json';
    const request: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0,
      messages: this.buildMessages(messages, jsonMode),
      stream: true,
      ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    };

    yield* this.executeStreamWithRetry(request);
  }

  // ── Override doStream to capture delta.reasoning_content ────────

  protected async *doStream(
    request: OpenAI.ChatCompletionCreateParamsStreaming,
  ): AsyncIterable<StreamChunk> {
    const reasoningParts: string[] = [];
    const stream = await this.client.chat.completions.create(request);

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Capture reasoning_content from delta (DeepSeek extension)
      const reasoningDelta = (delta as Record<string, unknown>)['reasoning_content'];
      const reasoningStr = typeof reasoningDelta === 'string' ? reasoningDelta : undefined;

      if (reasoningStr) {
        reasoningParts.push(reasoningStr);
      }

      const content = (delta as Record<string, unknown>)['content'];
      const contentStr = typeof content === 'string' ? content : undefined;

      if (contentStr || reasoningStr) {
        yield {
          content: contentStr ?? '',
          ...(reasoningStr ? { reasoningContent: reasoningStr } : {}),
        };
      }
    }

    if (reasoningParts.length > 0) {
      this.lastReasoningContent = reasoningParts.join('');
    }
  }

  // ── buildMessages helper (mirrors OpenAIProvider's toOpenAIMessages) ─

  private buildMessages(
    messages: Message[],
    jsonMode: boolean,
  ): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      const content =
        jsonMode && m.role === 'user' ? `${m.content}\n\nRespond with valid JSON only.` : m.content;
      return { role: m.role, content };
    });
  }
}
