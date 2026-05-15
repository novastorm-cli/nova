import type { EventBus } from '../contracts/IEventBus.js';
import type { LlmClient } from '../contracts/ILlmClient.js';
import type { ChatResponse, LlmOptions, Message, StreamChunk } from '../models/types.js';
import { executeWithRetry, streamWithRetry } from './retry.js';
import type { RetryOptions } from './retry.js';

/**
 * Options passed to BaseProvider's constructor.
 */
export interface BaseProviderOptions {
  /** EventBus for emitting provider_retry / provider_fallback events. */
  eventBus?: EventBus | undefined;
  /** The primary model name this provider is configured to use. */
  model?: string | undefined;
  /** Fallback model to try after all retries are exhausted (e.g. `models.micro`). */
  fallbackModel?: string | undefined;
}

/**
 * Abstract base class for all LLM providers.
 *
 * Owns:
 * - Shared retry policy (consumes `retry.ts`)
 * - JSON-mode helper (single source for the `\n\nRespond with valid JSON only.` suffix)
 * - Vision payload construction (via abstract `formatVisionRequest`)
 * - Error normalization to `ProviderError`
 * - Exponential backoff (1s, 2s, 4s; max 3 retries) with `provider_retry` WS events
 * - Fallback to `fallbackModel` after all retries exhausted
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

  /** Maximum number of retries (3 → 1s, 2s, 4s backoff after the initial attempt). */
  protected static readonly MAX_RETRIES = 3;
  /** Base delay for exponential backoff in ms. */
  protected static readonly RETRY_BASE_DELAY_MS = 1000;

  protected readonly eventBus?: EventBus | undefined;
  protected readonly model?: string | undefined;
  protected readonly fallbackModel?: string | undefined;

  constructor(options?: BaseProviderOptions) {
    this.eventBus = options?.eventBus;
    this.model = options?.model;
    this.fallbackModel = options?.fallbackModel;
  }

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

  // ── Shared retry options (used by chat / chatWithVision / stream) ──────

  /**
   * Builds the RetryOptions for LLM calls.
   * - 1 initial attempt + 3 retries = 4 total
   * - Exponential backoff: 1s, 2s, 4s
   * - Emits `provider_retry` WS event before each retry delay
   */
  protected buildRetryOptions(): RetryOptions {
    return {
      maxAttempts: BaseProvider.MAX_RETRIES + 1, // 4 = 1 initial + 3 retries
      baseDelayMs: BaseProvider.RETRY_BASE_DELAY_MS,
      onRetry: (info) => {
        this.eventBus?.emit({
          type: 'provider_retry',
          data: {
            attempt: info.attempt,
            waitMs: info.waitMs,
            reason: info.reason,
          },
        });
      },
    };
  }

  /**
   * Attempt fallback to `this.fallbackModel` when all primary-model retries are exhausted.
   * Returns the ChatResponse on success; re-throws the primary error on fallback failure.
   */
  private async tryFallback(
    messages: Message[],
    options: LlmOptions | undefined,
    primaryModel: string,
    primaryErr: unknown,
    buildRequest: (model: string) => unknown,
  ): Promise<ChatResponse> {
    const toModel = this.fallbackModel!;

    this.eventBus?.emit({
      type: 'provider_fallback',
      data: {
        fromModel: primaryModel,
        toModel,
        reason: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      },
    });

    const fallbackRequest = buildRequest(toModel);
    const raw = await this.doChat(fallbackRequest);
    return this.parseResponse(raw);
  }

  // ── LlmClient implementation (uses shared retry.ts) ───────────────────

  async chat(messages: Message[], options?: LlmOptions): Promise<ChatResponse> {
    const primaryModel = options?.model ?? this.model ?? 'unknown';
    const buildRequest = (model: string) => this.formatRequest(messages, { ...options, model });

    try {
      const raw = await executeWithRetry(
        () => this.doChat(buildRequest(primaryModel)),
        (e) => this.isRetryable(e),
        (e) => this.isAbort(e),
        (e) => this.toProviderError(e),
        this.buildRetryOptions(),
      );
      return this.parseResponse(raw);
    } catch (primaryErr) {
      if (this.fallbackModel && this.fallbackModel !== primaryModel) {
        try {
          return await this.tryFallback(messages, options, primaryModel, primaryErr, buildRequest);
        } catch {
          // Fallback also failed — throw the original error
          throw primaryErr;
        }
      }
      throw primaryErr;
    }
  }

  async chatWithVision(
    messages: Message[],
    images: Buffer[],
    options?: LlmOptions,
  ): Promise<ChatResponse> {
    const primaryModel = options?.model ?? this.model ?? 'unknown';
    const buildRequest = (model: string) =>
      this.formatVisionRequest(messages, images, { ...options, model });

    try {
      const raw = await executeWithRetry(
        () => this.doChat(buildRequest(primaryModel)),
        (e) => this.isRetryable(e),
        (e) => this.isAbort(e),
        (e) => this.toProviderError(e),
        this.buildRetryOptions(),
      );
      return this.parseResponse(raw);
    } catch (primaryErr) {
      if (this.fallbackModel && this.fallbackModel !== primaryModel) {
        try {
          return await this.tryFallback(messages, options, primaryModel, primaryErr, buildRequest);
        } catch {
          throw primaryErr;
        }
      }
      throw primaryErr;
    }
  }

  async *stream(messages: Message[], options?: LlmOptions): AsyncIterable<StreamChunk> {
    const primaryModel = options?.model ?? this.model ?? 'unknown';

    try {
      const request = this.formatStreamRequest(messages, { ...options, model: primaryModel });
      for await (const rawChunk of streamWithRetry(
        () => this.doStream(request),
        (e) => this.isRetryable(e),
        (e) => this.isAbort(e),
        (e) => this.toProviderError(e),
        this.buildRetryOptions(),
      )) {
        const chunk = this.parseStreamChunk(rawChunk);
        if (chunk) yield chunk;
      }
    } catch (primaryErr) {
      if (this.fallbackModel && this.fallbackModel !== primaryModel) {
        this.eventBus?.emit({
          type: 'provider_fallback',
          data: {
            fromModel: primaryModel,
            toModel: this.fallbackModel,
            reason: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
          },
        });

        try {
          const fallbackRequest = this.formatStreamRequest(messages, {
            ...options,
            model: this.fallbackModel,
          });
          for await (const rawChunk of this.doStream(fallbackRequest)) {
            const chunk = this.parseStreamChunk(rawChunk);
            if (chunk) yield chunk;
          }
          return;
        } catch {
          // Fallback also failed — throw the original error
        }
      }
      throw primaryErr;
    }
  }
}
