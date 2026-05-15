import Anthropic from '@anthropic-ai/sdk';
import type { ChatResponse, LlmOptions, Message, StreamChunk } from '../models/types.js';
import { ProviderError } from '../contracts/ILlmClient.js';
import { BaseProvider } from './BaseProvider.js';
import type { BaseProviderOptions } from './BaseProvider.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;

function toAnthropicRole(role: Message['role']): 'user' | 'assistant' {
  return role === 'assistant' ? 'assistant' : 'user';
}

export class AnthropicProvider extends BaseProvider {
  protected readonly providerName = 'anthropic';
  private readonly client: Anthropic;

  constructor(apiKey: string, baseOptions?: BaseProviderOptions) {
    super(baseOptions);
    this.client = new Anthropic({ apiKey });
  }

  // ── formatRequest ──────────────────────────────────────────

  protected formatRequest(
    messages: Message[],
    options?: LlmOptions,
  ): Anthropic.MessageCreateParamsNonStreaming {
    const jsonMode = options?.responseFormat === 'json';
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    return {
      model: options?.model ?? DEFAULT_MODEL,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: nonSystem.map((m) => ({
        role: toAnthropicRole(m.role),
        content: this.toJsonMode(m.content, jsonMode && m.role === 'user'),
      })),
    };
  }

  // ── formatStreamRequest ────────────────────────────────────

  protected formatStreamRequest(
    messages: Message[],
    options?: LlmOptions,
  ): Anthropic.MessageCreateParamsStreaming {
    const jsonMode = options?.responseFormat === 'json';
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    return {
      model: options?.model ?? DEFAULT_MODEL,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      stream: true,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: nonSystem.map((m) => ({
        role: toAnthropicRole(m.role),
        content: this.toJsonMode(m.content, jsonMode && m.role === 'user'),
      })),
    };
  }

  // ── formatVisionRequest ────────────────────────────────────

  protected formatVisionRequest(
    messages: Message[],
    images: Buffer[],
    options?: LlmOptions,
  ): Anthropic.MessageCreateParamsNonStreaming {
    const jsonMode = options?.responseFormat === 'json';
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    const lastUserIdx = this.findLastUserIndex(nonSystem);
    if (lastUserIdx === -1) {
      throw new ProviderError(
        'No user message found for vision request',
        undefined,
        this.providerName,
      );
    }

    const imageBlocks: Anthropic.ImageBlockParam[] = images.map((img) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/png' as const,
        data: img.toString('base64'),
      },
    }));

    const anthropicMessages: Anthropic.MessageParam[] = nonSystem.map((m, i) => {
      if (i === lastUserIdx) {
        const textContent = this.toJsonMode(m.content, jsonMode);
        return {
          role: toAnthropicRole(m.role),
          content: [...imageBlocks, { type: 'text' as const, text: textContent }],
        };
      }
      return {
        role: toAnthropicRole(m.role),
        content: m.content,
      };
    });

    return {
      model: options?.model ?? DEFAULT_MODEL,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: anthropicMessages,
    };
  }

  // ── doChat / doStream ──────────────────────────────────────

  protected async doChat(request: unknown): Promise<Anthropic.Message> {
    return this.client.messages.create(request as Anthropic.MessageCreateParamsNonStreaming);
  }

  protected async *doStream(request: unknown): AsyncIterable<Anthropic.RawMessageStreamEvent> {
    const stream = this.client.messages.stream(request as Anthropic.MessageCreateParamsStreaming);
    for await (const event of stream) {
      yield event;
    }
  }

  // ── parseResponse / parseStreamChunk ───────────────────────

  protected parseResponse(raw: unknown): ChatResponse {
    const response = raw as Anthropic.Message;
    const textBlock = response.content.find((b) => b.type === 'text');
    return { content: textBlock ? textBlock.text : '' };
  }

  protected parseStreamChunk(raw: unknown): StreamChunk | null {
    const event = raw as Anthropic.RawMessageStreamEvent;
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      return { content: event.delta.text };
    }
    return null;
  }

  // ── Error classification ───────────────────────────────────

  protected isRetryable(err: unknown): boolean {
    return err instanceof Anthropic.APIError && err.status === 429;
  }

  protected isAbort(err: unknown): boolean {
    if (!(err instanceof Anthropic.APIError)) return false;
    return err.status === 401;
  }

  protected toProviderError(err: unknown): never {
    if (err instanceof ProviderError) throw err;

    if (err instanceof Anthropic.APIError) {
      throw new ProviderError(err.message, Number(err.status), this.providerName);
    }

    throw new ProviderError(
      err instanceof Error ? err.message : String(err),
      undefined,
      this.providerName,
    );
  }
}
