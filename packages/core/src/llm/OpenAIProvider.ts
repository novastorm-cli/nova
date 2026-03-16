import OpenAI from 'openai';
import type { LlmClient, LlmOptions, Message } from '../models/types.js';
import { ProviderError } from '../contracts/ILlmClient.js';

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;
const RETRY_DELAY_MS = 1000;

function toOpenAIMessages(
  messages: Message[],
  jsonMode: boolean,
): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    const content = jsonMode && m.role === 'user'
      ? `${m.content}\n\nRespond with valid JSON only.`
      : m.content;
    return { role: m.role, content };
  });
}

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i]!)) return i;
  }
  return -1;
}

const APIError = OpenAI.APIError;

function isApiError(err: unknown): err is InstanceType<typeof APIError> {
  return err instanceof APIError;
}

function handleError(err: unknown, provider: string): never {
  if (err instanceof ProviderError) throw err;

  if (isApiError(err)) {
    throw new ProviderError(err.message, err.status, provider);
  }

  throw new ProviderError(
    err instanceof Error ? err.message : String(err),
    undefined,
    provider,
  );
}

function shouldRetry(err: unknown): boolean {
  return isApiError(err) && err.status === 429;
}

function shouldThrowImmediately(err: unknown): boolean {
  return isApiError(err) && err.status === 401;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAIProvider implements LlmClient {
  protected readonly client: OpenAI;
  protected readonly providerName: string;
  protected readonly defaultModel: string;

  constructor(apiKey: string, baseURL?: string, providerName = 'openai', defaultModel = DEFAULT_MODEL) {
    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    this.providerName = providerName;
    this.defaultModel = defaultModel;
  }

  async chat(messages: Message[], options?: LlmOptions): Promise<string> {
    const jsonMode = options?.responseFormat === 'json';
    const request: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      messages: toOpenAIMessages(messages, jsonMode),
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };

    return this.executeWithRetry(async () => {
      const response = await this.client.chat.completions.create(request);
      return response.choices[0]?.message?.content ?? '';
    });
  }

  async chatWithVision(
    messages: Message[],
    images: Buffer[],
    options?: LlmOptions,
  ): Promise<string> {
    const jsonMode = options?.responseFormat === 'json';
    const lastUserIdx = findLastIndex(messages, (m) => m.role === 'user');
    if (lastUserIdx === -1) {
      throw new ProviderError('No user message found for vision request', undefined, this.providerName);
    }

    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map((m, i) => {
      if (i === lastUserIdx) {
        const imageParts: OpenAI.ChatCompletionContentPartImage[] = images.map((img) => ({
          type: 'image_url' as const,
          image_url: {
            url: `data:image/png;base64,${img.toString('base64')}`,
          },
        }));
        const textContent = jsonMode
          ? `${m.content}\n\nRespond with valid JSON only.`
          : m.content;

        return {
          role: m.role as 'user',
          content: [
            { type: 'text' as const, text: textContent },
            ...imageParts,
          ],
        };
      }
      const content = jsonMode && m.role === 'user'
        ? `${m.content}\n\nRespond with valid JSON only.`
        : m.content;
      return { role: m.role, content } as OpenAI.ChatCompletionMessageParam;
    });

    const request: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      messages: openaiMessages,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };

    return this.executeWithRetry(async () => {
      const response = await this.client.chat.completions.create(request);
      return response.choices[0]?.message?.content ?? '';
    });
  }

  async *stream(messages: Message[], options?: LlmOptions): AsyncIterable<string> {
    const jsonMode = options?.responseFormat === 'json';
    const request: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      messages: toOpenAIMessages(messages, jsonMode),
      stream: true,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };

    yield* this.executeStreamWithRetry(request);
  }

  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (shouldThrowImmediately(err)) handleError(err, this.providerName);
      if (shouldRetry(err)) {
        await delay(RETRY_DELAY_MS);
        try {
          return await fn();
        } catch (retryErr) {
          handleError(retryErr, this.providerName);
        }
      }
      handleError(err, this.providerName);
    }
  }

  private async *executeStreamWithRetry(
    request: OpenAI.ChatCompletionCreateParamsStreaming,
  ): AsyncIterable<string> {
    try {
      yield* this.doStream(request);
    } catch (err) {
      if (shouldThrowImmediately(err)) handleError(err, this.providerName);
      if (shouldRetry(err)) {
        await delay(RETRY_DELAY_MS);
        try {
          yield* this.doStream(request);
        } catch (retryErr) {
          handleError(retryErr, this.providerName);
        }
        return;
      }
      handleError(err, this.providerName);
    }
  }

  private async *doStream(
    request: OpenAI.ChatCompletionCreateParamsStreaming,
  ): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create(request);
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }
}
