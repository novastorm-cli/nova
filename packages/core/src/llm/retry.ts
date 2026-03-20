export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterFactor: 0.2,
};

function computeDelay(attempt: number, options: Required<RetryOptions>): number {
  const exponential = options.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, options.maxDelayMs);
  const jitter = capped * options.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, capped + jitter);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (err: unknown) => boolean,
  shouldAbort: (err: unknown) => boolean,
  handleError: (err: unknown) => never,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (shouldAbort(err)) handleError(err);
      if (!shouldRetry(err) || attempt === opts.maxAttempts - 1) handleError(err);
      await delay(computeDelay(attempt, opts));
    }
  }

  // Unreachable but TypeScript needs it
  throw new Error('Retry exhausted');
}

export async function* streamWithRetry<T>(
  fn: () => AsyncIterable<T>,
  shouldRetry: (err: unknown) => boolean,
  shouldAbort: (err: unknown) => boolean,
  handleError: (err: unknown) => never,
  options?: RetryOptions,
): AsyncIterable<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      yield* fn();
      return;
    } catch (err) {
      if (shouldAbort(err)) handleError(err);
      if (!shouldRetry(err) || attempt === opts.maxAttempts - 1) handleError(err);
      await delay(computeDelay(attempt, opts));
    }
  }
}
