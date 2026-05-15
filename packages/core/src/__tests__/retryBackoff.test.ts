import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseProvider } from '../llm/BaseProvider.js';
import type { BaseProviderOptions } from '../llm/BaseProvider.js';
import type { ChatResponse, LlmOptions, Message, StreamChunk } from '../models/types.js';
import type { NovaEvent } from '../models/events.js';
import { ProviderError } from '../contracts/ILlmClient.js';
import { NovaEventBus } from '../events/EventBus.js';

// ── Helpers ───────────────────────────────────────────────────────────

type ProviderRetryEvent = Extract<NovaEvent, { type: 'provider_retry' }>;
type ProviderFallbackEvent = Extract<NovaEvent, { type: 'provider_fallback' }>;

function collectEvents(eventBus: NovaEventBus): {
  retries: ProviderRetryEvent['data'][];
  fallbacks: ProviderFallbackEvent['data'][];
} {
  const retries: ProviderRetryEvent['data'][] = [];
  const fallbacks: ProviderFallbackEvent['data'][] = [];

  eventBus.on('provider_retry', (event: ProviderRetryEvent) => {
    retries.push(event.data);
  });
  eventBus.on('provider_fallback', (event: ProviderFallbackEvent) => {
    fallbacks.push(event.data);
  });

  return { retries, fallbacks };
}

// ── Mock provider that always throws ──────────────────────────────────

class TestProvider extends BaseProvider {
  private callCount = 0;
  private readonly errorToThrow: Error;
  private readonly retryable: boolean;

  constructor(errorToThrow: Error, retryable: boolean, baseOptions?: BaseProviderOptions) {
    super(baseOptions);
    this.errorToThrow = errorToThrow;
    this.retryable = retryable;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected formatRequest(messages: Message[], options?: LlmOptions): unknown {
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected formatStreamRequest(messages: Message[], options?: LlmOptions): unknown {
    return {};
  }

  protected formatVisionRequest(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    messages: Message[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    images: Buffer[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: LlmOptions,
  ): unknown {
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  protected async doChat(_request: unknown): Promise<unknown> {
    this.callCount++;
    throw this.errorToThrow;
  }

  // eslint-disable-next-line require-yield, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  protected async *doStream(_request: unknown): AsyncIterable<unknown> {
    this.callCount++;
    throw this.errorToThrow;
  }

  protected parseResponse(raw: unknown): ChatResponse {
    return raw as ChatResponse;
  }

  protected parseStreamChunk(raw: unknown): StreamChunk | null {
    return raw as StreamChunk;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected isRetryable(_err: unknown): boolean {
    return this.retryable;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected isAbort(_err: unknown): boolean {
    return false;
  }

  protected toProviderError(err: unknown): never {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(err instanceof Error ? err.message : String(err), 429, 'test');
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// ── Provider that supports fallback (succeeds on fallback model) ──────

class FallbackTestProvider extends BaseProvider {
  private callCount = 0;

  constructor(baseOptions?: BaseProviderOptions) {
    super(baseOptions);
  }

  protected formatRequest(messages: Message[], options?: LlmOptions): unknown {
    void messages; // consumed by base class contract
    return { model: options?.model ?? 'primary-model' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected formatStreamRequest(messages: Message[], options?: LlmOptions): unknown {
    return {};
  }

  protected formatVisionRequest(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    messages: Message[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    images: Buffer[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: LlmOptions,
  ): unknown {
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  protected async doChat(request: unknown): Promise<unknown> {
    this.callCount++;
    const req = request as { model: string };
    if (req.model === 'primary-model') {
      throw new Error('429 Too Many Requests');
    }
    return { content: 'Fallback response' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async *doStream(_request: unknown): AsyncIterable<unknown> {
    // noop — stream not exercised in fallback tests
  }

  protected parseResponse(raw: unknown): ChatResponse {
    const r = raw as { content: string };
    return { content: r.content ?? '' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected parseStreamChunk(_raw: unknown): StreamChunk | null {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected isRetryable(_err: unknown): boolean {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected isAbort(_err: unknown): boolean {
    return false;
  }

  protected toProviderError(err: unknown): never {
    throw new ProviderError(err instanceof Error ? err.message : String(err), 429, 'test');
  }

  getCallCount(): number {
    return this.callCount;
  }
}

const messages: Message[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello' },
];

describe('Retry backoff', () => {
  // ── VAL-ARCH-036: Exponential backoff timing ─────────────────────────

  describe('VAL-ARCH-036: exponential backoff timing', () => {
    it('retries 3 times with delays 1s, 2s, 4s', async () => {
      const delays: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;

      // Mock Math.random to return 0.5 so jitter is 0 (exact delays)
      const originalRandom = Math.random;
      Math.random = vi.fn().mockReturnValue(0.5);

      vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
        if (ms && ms > 0) delays.push(ms);
        return originalSetTimeout(fn, 0);
      });

      const eventBus = new NovaEventBus();

      const provider = new TestProvider(
        new Error('429 Too Many Requests'),
        true, // retryable
        { eventBus, model: 'test-model' },
      );

      try {
        await provider.chat(messages);
      } catch {
        // Expected — all retries exhausted
      }

      // Verify delays (jitter mocked to 0 means exact values)
      expect(delays.length).toBe(3);
      // Retry 1: 1000ms
      expect(delays[0]!).toBe(1000);
      // Retry 2: 2000ms
      expect(delays[1]!).toBe(2000);
      // Retry 3: 4000ms
      expect(delays[2]!).toBe(4000);

      // Verify total attempts: 4 (1 initial + 3 retries)
      expect(provider.getCallCount()).toBe(4);

      Math.random = originalRandom;
      vi.restoreAllMocks();
    });

    it('does not retry on non-retryable errors', async () => {
      const eventBus = new NovaEventBus();
      const provider = new TestProvider(
        new Error('401 Unauthorized'),
        false, // not retryable
        { eventBus, model: 'test-model' },
      );

      await expect(provider.chat(messages)).rejects.toThrow(ProviderError);
      expect(provider.getCallCount()).toBe(1); // Only initial attempt
    });
  });

  // ── VAL-ARCH-037: provider_retry events ─────────────────────────────

  describe('VAL-ARCH-037: provider_retry events', () => {
    let eventBus: NovaEventBus;
    let originalRandom: () => number;

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      eventBus = new NovaEventBus();
      originalRandom = Math.random;
      Math.random = vi.fn().mockReturnValue(0.5); // zero jitter
    });

    afterEach(() => {
      Math.random = originalRandom;
      vi.useRealTimers();
    });

    it('emits 3 provider_retry events with correct attempt/waitMs/reason', async () => {
      const { retries: retryEvents } = collectEvents(eventBus);

      const provider = new TestProvider(new Error('429 Rate limit exceeded'), true, {
        eventBus,
        model: 'test-model',
      });

      // Start the chat — it will throw after retries exhausted
      const chatPromise = provider.chat(messages).catch(() => {
        /* swallow */
      });

      // Advance timers to let all retries complete
      await vi.advanceTimersByTimeAsync(10000);
      await chatPromise;

      expect(retryEvents.length).toBe(3);

      // Retry 1: 1000ms
      expect(retryEvents[0]!.attempt).toBe(1);
      expect(retryEvents[0]!.waitMs).toBe(1000);
      expect(retryEvents[0]!.reason).toContain('429');

      // Retry 2: 2000ms
      expect(retryEvents[1]!.attempt).toBe(2);
      expect(retryEvents[1]!.waitMs).toBe(2000);

      // Retry 3: 4000ms
      expect(retryEvents[2]!.attempt).toBe(3);
      expect(retryEvents[2]!.waitMs).toBe(4000);
    });
  });

  // ── VAL-ARCH-038: Fallback to models.micro ──────────────────────────

  describe('VAL-ARCH-038: fallback to models.micro', () => {
    it('attempts fallback to micro model after 3 retries exhausted', async () => {
      const eventBus = new NovaEventBus();
      const { retries: retryEvents, fallbacks: fallbackEvents } = collectEvents(eventBus);

      vi.useFakeTimers({ shouldAdvanceTime: true });

      const provider = new FallbackTestProvider({
        eventBus,
        model: 'primary-model',
        fallbackModel: 'micro-model',
      });

      const chatPromise = provider.chat(messages);

      // Advance timers to let all retries + fallback complete
      await vi.advanceTimersByTimeAsync(10000);
      const result = await chatPromise;

      vi.useRealTimers();

      // Verify result came from fallback
      expect(result.content).toBe('Fallback response');

      // Verify retry events: 3 attempts on primary model
      expect(retryEvents.length).toBe(3);

      // Verify fallback event emitted
      expect(fallbackEvents.length).toBe(1);
      expect(fallbackEvents[0]!.fromModel).toBe('primary-model');
      expect(fallbackEvents[0]!.toModel).toBe('micro-model');
      expect(fallbackEvents[0]!.reason).toContain('429');
    });

    it('does not attempt fallback when fallbackModel is not configured', async () => {
      const eventBus = new NovaEventBus();
      const { fallbacks: fallbackEvents } = collectEvents(eventBus);

      const provider = new TestProvider(
        new Error('429 Too Many Requests'),
        true,
        { eventBus, model: 'primary-model' }, // no fallbackModel
      );

      vi.useFakeTimers({ shouldAdvanceTime: true });
      const chatPromise = provider.chat(messages).catch(() => {
        /* swallow */
      });
      await vi.advanceTimersByTimeAsync(10000);
      await chatPromise;
      vi.useRealTimers();

      expect(fallbackEvents.length).toBe(0);
      expect(provider.getCallCount()).toBe(4); // 4 attempts on primary (1 + 3 retries)
    });

    it('does not fallback when fallbackModel equals primary model', async () => {
      const eventBus = new NovaEventBus();
      const { fallbacks: fallbackEvents } = collectEvents(eventBus);

      const provider = new TestProvider(new Error('429 Too Many Requests'), true, {
        eventBus,
        model: 'same-model',
        fallbackModel: 'same-model',
      });

      vi.useFakeTimers({ shouldAdvanceTime: true });
      const chatPromise = provider.chat(messages).catch(() => {
        /* swallow */
      });
      await vi.advanceTimersByTimeAsync(10000);
      await chatPromise;
      vi.useRealTimers();

      expect(fallbackEvents.length).toBe(0);
    });
  });
});
