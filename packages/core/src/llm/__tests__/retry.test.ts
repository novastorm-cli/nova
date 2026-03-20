import { describe, it, expect, vi } from 'vitest';
import { executeWithRetry, streamWithRetry } from '../retry.js';

class TestError extends Error {
  constructor(public retryable: boolean) {
    super('test error');
  }
}

const shouldRetry = (err: unknown) => err instanceof TestError && err.retryable;
const shouldAbort = (_err: unknown) => false;
const handleError = (err: unknown): never => { throw err; };

describe('executeWithRetry', () => {
  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await executeWithRetry(fn, shouldRetry, shouldAbort, handleError);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TestError(true))
      .mockResolvedValue('ok');
    const result = await executeWithRetry(fn, shouldRetry, shouldAbort, handleError, {
      baseDelayMs: 10,
      maxDelayMs: 50,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new TestError(false));
    await expect(
      executeWithRetry(fn, shouldRetry, shouldAbort, handleError, { maxAttempts: 3, baseDelayMs: 10 })
    ).rejects.toThrow('test error');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should respect maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new TestError(true));
    await expect(
      executeWithRetry(fn, shouldRetry, shouldAbort, handleError, {
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 50,
      })
    ).rejects.toThrow('test error');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should abort immediately when shouldAbort returns true', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('abort'));
    const abortAll = () => true;
    await expect(
      executeWithRetry(fn, shouldRetry, abortAll, handleError, { maxAttempts: 3, baseDelayMs: 10 })
    ).rejects.toThrow('abort');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should use exponential backoff with bounded delays', async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any, ms?: number) => {
      if (ms && ms > 0) delays.push(ms);
      return originalSetTimeout(fn, 0);
    });

    const fn = vi.fn()
      .mockRejectedValueOnce(new TestError(true))
      .mockRejectedValueOnce(new TestError(true))
      .mockResolvedValue('ok');

    await executeWithRetry(fn, shouldRetry, shouldAbort, handleError, {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      jitterFactor: 0,
    });

    expect(delays.length).toBe(2);
    // First retry: 100 * 2^0 = 100
    expect(delays[0]).toBe(100);
    // Second retry: 100 * 2^1 = 200
    expect(delays[1]).toBe(200);

    vi.restoreAllMocks();
  });
});

describe('streamWithRetry', () => {
  it('should yield all values on success', async () => {
    async function* gen() { yield 'a'; yield 'b'; }
    const results: string[] = [];
    for await (const val of streamWithRetry(gen, shouldRetry, shouldAbort, handleError)) {
      results.push(val);
    }
    expect(results).toEqual(['a', 'b']);
  });

  it('should retry on retryable stream errors', async () => {
    let attempt = 0;
    async function* gen() {
      attempt++;
      if (attempt === 1) throw new TestError(true);
      yield 'ok';
    }
    const results: string[] = [];
    for await (const val of streamWithRetry(gen, shouldRetry, shouldAbort, handleError, { baseDelayMs: 10 })) {
      results.push(val);
    }
    expect(results).toEqual(['ok']);
    expect(attempt).toBe(2);
  });
});
