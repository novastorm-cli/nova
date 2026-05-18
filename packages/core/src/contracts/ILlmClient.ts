import type { ChatResponse, LlmOptions, Message, StreamChunk } from '../models/types.js';

/**
 * Canonical interface for LLM providers.
 *
 * Each provider implements LlmClient:
 *
 * chat():
 * - Sends messages to the model, returns full response text
 * - Throws ProviderError on HTTP 401 (invalid key), 429 (rate limit), 5xx (server error)
 * - Retries once on 429 with exponential backoff (1s)
 * - Respects options.model to override default model
 * - Respects options.maxTokens (default: 4096)
 * - Respects options.temperature (default: 0)
 * - When options.responseFormat is 'json', instructs model to respond with valid JSON
 *
 * chatWithVision():
 * - Same as chat(), but includes images as base64-encoded parts in the user message
 * - images are Buffer[] of PNG data
 * - Throws ProviderError if the model doesn't support vision
 *
 * stream():
 * - Returns an AsyncIterable that yields text chunks as they arrive
 * - Throws ProviderError on same conditions as chat()
 * - Consumer can break out of the loop to cancel the stream
 */
export interface LlmClient {
  /** Whether this provider supports multimodal vision calls (chatWithVision). */
  readonly supportsVision: boolean;

  chat(messages: Message[], options?: LlmOptions): Promise<ChatResponse>;
  chatWithVision(
    messages: Message[],
    images: Buffer[],
    options?: LlmOptions,
  ): Promise<ChatResponse>;
  stream(messages: Message[], options?: LlmOptions): AsyncIterable<StreamChunk>;
}

/**
 * Factory that creates an LlmClient for the given provider.
 *
 * Supported providers: 'anthropic', 'openrouter', 'openai', 'ollama'
 *
 * @throws {ProviderError} if provider is unknown
 * @throws {ProviderError} if apiKey is missing for non-ollama providers
 */
export interface IProviderFactory {
  create(provider: string, apiKey?: string): LlmClient;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly provider?: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
