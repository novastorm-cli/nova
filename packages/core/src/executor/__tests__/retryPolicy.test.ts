import { describe, it, expect, beforeEach } from 'vitest';
import { RetryPolicy } from '../RetryPolicy.js';

describe('RetryPolicy', () => {
  let policy: RetryPolicy;

  beforeEach(() => {
    policy = new RetryPolicy(3);
  });

  it('should allow retries within the max budget', () => {
    expect(policy.canRetry('task-1')).toBe(true);
  });

  it('should record retries and return backoff delay', () => {
    const delay1 = policy.recordRetry('task-1');
    expect(delay1).toBe(1000); // First retry: 1s backoff
    expect(policy.getRetryCount('task-1')).toBe(1);
    expect(policy.getTotalAttempts('task-1')).toBe(2); // 1 initial + 1 retry

    const delay2 = policy.recordRetry('task-1');
    expect(delay2).toBe(2000); // Second retry: 2s backoff
    expect(policy.getRetryCount('task-1')).toBe(2);

    const delay3 = policy.recordRetry('task-1');
    expect(delay3).toBe(4000); // Third retry: 4s backoff
    expect(policy.getRetryCount('task-1')).toBe(3);
  });

  it('should deny retries when max budget is exhausted', () => {
    policy.recordRetry('task-1'); // 1
    policy.recordRetry('task-1'); // 2
    policy.recordRetry('task-1'); // 3

    expect(policy.canRetry('task-1')).toBe(false);
    expect(policy.getRetryCount('task-1')).toBe(3);
    expect(policy.getTotalAttempts('task-1')).toBe(4); // 1 initial + 3 retries

    // Further recordRetry returns -1
    expect(policy.recordRetry('task-1')).toBe(-1);
  });

  it('should track retries independently per task', () => {
    policy.recordRetry('task-1');
    policy.recordRetry('task-1');
    policy.recordRetry('task-2');

    expect(policy.getRetryCount('task-1')).toBe(2);
    expect(policy.getRetryCount('task-2')).toBe(1);
    expect(policy.canRetry('task-1')).toBe(true);
    expect(policy.canRetry('task-2')).toBe(true);
  });

  it('should reset a task retry counter', () => {
    policy.recordRetry('task-1');
    policy.recordRetry('task-1');
    policy.reset('task-1');

    expect(policy.getRetryCount('task-1')).toBe(0);
    expect(policy.canRetry('task-1')).toBe(true);
  });

  it('should count total retries across all tasks', () => {
    policy.recordRetry('task-1');
    policy.recordRetry('task-1');
    policy.recordRetry('task-2');
    policy.recordRetry('task-3');
    policy.recordRetry('task-3');
    policy.recordRetry('task-3');

    expect(policy.getTotalRetries()).toBe(6);
  });

  it('should ensure total attempts per task ≤ maxRetries + 1', () => {
    // Verifies VAL-ARCH-019: Total LLM retries per task ≤ 8
    // With maxRetries=3, max total attempts = 4, which is ≤ 8
    for (let i = 0; i < 10; i++) {
      policy.recordRetry('task-1');
    }

    expect(policy.getRetryCount('task-1')).toBe(3); // Capped at maxRetries
    expect(policy.getTotalAttempts('task-1')).toBe(4); // 1 + 3 ≤ 8
  });

  it('should use custom max retries', () => {
    const customPolicy = new RetryPolicy(5);
    for (let i = 0; i < 5; i++) {
      expect(customPolicy.canRetry('task-1')).toBe(true);
      customPolicy.recordRetry('task-1');
    }
    expect(customPolicy.canRetry('task-1')).toBe(false);
    expect(customPolicy.getRetryCount('task-1')).toBe(5);
  });

  it('should use exponential backoff: 1s, 2s, 4s for maxRetries=3', () => {
    const p = new RetryPolicy(3);
    expect(p.recordRetry('t1')).toBe(1000);
    expect(p.recordRetry('t1')).toBe(2000);
    expect(p.recordRetry('t1')).toBe(4000);
  });
});
