import type { LlmClient } from '../contracts/ILlmClient.js';
import type { ChatResponse, LlmOptions, Message, StreamChunk } from '../models/types.js';
import { executeWithRetry, streamWithRetry } from './retry.js';

/**
 * Abstract base class for all LLM providers.
 *
 * Owns:
 * - Shared retry policy (consumes `retry.ts`)
 * - JSON-mode helper (single source for the `\n\nRespond with valid JSON only.` suffix)
 * - Vision payload construction (via abstract `formatVisionRequest`)
 * - Error normalization to `ProviderError`
 *
 * Each concrete provider implements only:
 * - `formatRequest` / `formatStreamRequest` / `formatVisionRequest` — build provider-specific requests
 * - `parseResponse` / `parseStreamChunk` — parse raw responses into normalized types
 * - `doChat` / `doStream` — execute the actual API calls
 * - `isRetryable` / `isAbort` / `toProviderError` — error classification & normalization
 */
export abstract class BaseProvider implements LlmClient {
  /** Single source of truth for the JSON-mode prompt suffix. */
  protected static readonly JSON_SUFFIX = '\n\nRespond with valid JSON only.';

  // ── Shared helpers ────────────────────────────────────────────────────

  /**
   * Appends the JSON-mode suffix to content when jsonMode is true.
   * All providers MUST use this method rather than inlining the suffix.
   */
  protected toJsonMode(content: string, jsonMode: boolean): string {
    return jsonMode ? `${content}${BaseProvider.JSON_SUFFIX}` : content;
  }

  /**
   * Returns the index of the last user message in the array.
   * Uses native `Array.prototype.findLastIndex` (Node 22+).
   */
  protected findLastUserIndex(messages: Message[]): number {
    return messages.findLastIndex((m) => m.role === 'user');
  }

  // ── Abstract: provider-specific logic ─────────────────────────────────

  /** Build provider-specific request for non-streaming chat. */
  protected abstract formatRequest(messages: Message[], options?: LlmOptions): unknown;

  /** Build provider-specific request for streaming chat. */
  protected abstract formatStreamRequest(messages: Message[], options?: LlmOptions): unknown;

  /** Build provider-specific request for vision (multimodal) chat. */
  protected abstract formatVisionRequest(
    messages: Message[],
    images: Buffer[],
    options?: LlmOptions,
  ): unknown;

  /** Execute the actual non-streaming API call. Returns raw provider response. */
  protected abstract doChat(request: unknown): Promise<unknown>;

  /** Execute the actual streaming API call. Returns async iterable of raw chunks. */
  protected abstract doStream(request: unknown): AsyncIterable<unknown>;

  /** Parse raw non-streaming response → normalized ChatResponse. */
  protected abstract parseResponse(raw: unknown): ChatResponse;

  /** Parse raw streaming chunk → normalized StreamChunk, or null to skip. */
  protected abstract parseStreamChunk(raw: unknown): StreamChunk | null;

  /** Whether the given error is retryable (e.g., HTTP 429 rate limit). */
  protected abstract isRetryable(err: unknown): boolean;

  /** Whether the given error should abort immediately without retry (e.g., HTTP 401). */
  protected abstract isAbort(err: unknown): boolean;

  /** Normalize the given error into a ProviderError and throw (never returns). */
  protected abstract toProviderError(err: unknown): never;

  // ── LlmClient implementation (uses shared retry.ts) ───────────────────

  async chat(messages: Message[], options?: LlmOptions): Promise<ChatResponse> {
    const request = this.formatRequest(messages, options);
    const raw = await executeWithRetry(
      () => this.doChat(request),
      (e) => this.isRetryable(e),
      (e) => this.isAbort(e),
      (e) => this.toProviderError(e),
    );
    return this.parseResponse(raw);
  }

  async chatWithVision(
    messages: Message[],
    images: Buffer[],
    options?: LlmOptions,
  ): Promise<ChatResponse> {
    const request = this.formatVisionRequest(messages, images, options);
    const raw = await executeWithRetry(
      () => this.doChat(request),
      (e) => this.isRetryable(e),
      (e) => this.isAbort(e),
      (e) => this.toProviderError(e),
    );
    return this.parseResponse(raw);
  }

  async *stream(messages: Message[], options?: LlmOptions): AsyncIterable<StreamChunk> {
    const request = this.formatStreamRequest(messages, options);
    for await (const rawChunk of streamWithRetry(
      () => this.doStream(request),
      (e) => this.isRetryable(e),
      (e) => this.isAbort(e),
      (e) => this.toProviderError(e),
    )) {
      const chunk = this.parseStreamChunk(rawChunk);
      if (chunk) yield chunk;
    }
  }
}
