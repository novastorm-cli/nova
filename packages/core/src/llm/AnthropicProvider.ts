import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmOptions, Message } from '../models/types.js';
import { ProviderError } from '../contracts/ILlmClient.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;
const RETRY_DELAY_MS = 1000;

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i]!)) return i;
  }
  return -1;
}

function toAnthropicRole(role: Message['role']): 'user' | 'assistant' {
  return role === 'assistant' ? 'assistant' : 'user';
}

function handleError(err: unknown): never {
  if (err instanceof ProviderError) throw err;

  if (err instanceof Anthropic.APIError) {
    throw new ProviderError(
      err.message,
      err.status,
      'anthropic',
    );
  }

  throw new ProviderError(
    err instanceof Error ? err.message : String(err),
    undefined,
    'anthropic',
  );
}

function shouldRetry(err: unknown): boolean {
  return err instanceof Anthropic.APIError && err.status === 429;
}

function shouldThrowImmediately(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  return err.status === 401;
}

export class AnthropicProvider implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(messages: Message[], options?: LlmOptions): Promise<string> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model: options?.model ?? DEFAULT_MODEL,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: nonSystem.map((m) => ({
        role: toAnthropicRole(m.role),
        content: options?.responseFormat === 'json'
          ? `${m.content}\n\nRespond with valid JSON only.`
          : m.content,
      })),
    };

    return this.executeWithRetry(() => this.doChat(request));
  }

  async chatWithVision(
    messages: Message[],
    images: Buffer[],
    options?: LlmOptions,
  ): Promise<string> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    const lastUserIdx = findLastIndex(nonSystem, (m) => m.role === 'user');
    if (lastUserIdx === -1) {
      throw new ProviderError('No user message found for vision request', undefined, 'anthropic');
    }

    const anthropicMessages: Anthropic.MessageParam[] = nonSystem.map((m, i) => {
      if (i === lastUserIdx) {
        const imageBlocks: Anthropic.ImageBlockParam[] = images.map((img) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: 'image/png' as const,
            data: img.toString('base64'),
          },
        }));
        const textContent = options?.responseFormat === 'json'
          ? `${m.content}\n\nRespond with valid JSON only.`
          : m.content;

        return {
          role: toAnthropicRole(m.role),
          content: [
            ...imageBlocks,
            { type: 'text' as const, text: textContent },
          ],
        };
      }
      return {
        role: toAnthropicRole(m.role),
        content: m.content,
      };
    });

    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model: options?.model ?? DEFAULT_MODEL,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: anthropicMessages,
    };

    return this.executeWithRetry(() => this.doChat(request));
  }

  async *stream(messages: Message[], options?: LlmOptions): AsyncIterable<string> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    const request: Anthropic.MessageCreateParamsStreaming = {
      model: options?.model ?? DEFAULT_MODEL,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      stream: true,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: nonSystem.map((m) => ({
        role: toAnthropicRole(m.role),
        content: options?.responseFormat === 'json'
          ? `${m.content}\n\nRespond with valid JSON only.`
          : m.content,
      })),
    };

    yield* this.executeStreamWithRetry(request);
  }

  private async doChat(request: Anthropic.MessageCreateParamsNonStreaming): Promise<string> {
    const response = await this.client.messages.create(request);
    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock ? textBlock.text : '';
  }

  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (shouldThrowImmediately(err)) handleError(err);
      if (shouldRetry(err)) {
        await this.delay(RETRY_DELAY_MS);
        try {
          return await fn();
        } catch (retryErr) {
          handleError(retryErr);
        }
      }
      handleError(err);
    }
  }

  private async *executeStreamWithRetry(
    request: Anthropic.MessageCreateParamsStreaming,
  ): AsyncIterable<string> {
    try {
      yield* this.doStream(request);
    } catch (err) {
      if (shouldThrowImmediately(err)) handleError(err);
      if (shouldRetry(err)) {
        await this.delay(RETRY_DELAY_MS);
        try {
          yield* this.doStream(request);
        } catch (retryErr) {
          handleError(retryErr);
        }
        return;
      }
      handleError(err);
    }
  }

  private async *doStream(
    request: Anthropic.MessageCreateParamsStreaming,
  ): AsyncIterable<string> {
    const stream = this.client.messages.stream(request);
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
