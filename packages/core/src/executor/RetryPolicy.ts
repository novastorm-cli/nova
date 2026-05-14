import type { ILogger } from '../contracts/ILogger.js';

/**
 * Shared retry policy for the executor pool.
 * Lives at the pool level and is shared across all lanes.
 * Max 3 LLM retries per task with exponential backoff: 1s, 2s, 4s.
 */
export class RetryPolicy {
  private readonly retryCounts = new Map<string, number>();
  private readonly maxRetries: number;
  private readonly backoffMs: number[];
  private readonly logger?: ILogger;

  constructor(maxRetries = 3, logger?: ILogger) {
    this.maxRetries = maxRetries;
    // Exponential backoff: 1s, 2s, 4s, ...
    this.backoffMs = Array.from({ length: maxRetries }, (_, i) => 1000 * Math.pow(2, i));
    this.logger = logger;
  }

  /**
   * Check if a task can still retry (has remaining retry budget).
   */
  canRetry(taskId: string): boolean {
    const count = this.retryCounts.get(taskId) ?? 0;
    return count < this.maxRetries;
  }

  /**
   * Record a retry attempt for a task.
   * Returns the backoff delay in ms for this retry before the next attempt.
   */
  recordRetry(taskId: string): number {
    const count = this.retryCounts.get(taskId) ?? 0;
    if (count >= this.maxRetries) {
      return -1; // No more retries available
    }
    const delayMs = this.backoffMs[count] ?? 4000;
    this.retryCounts.set(taskId, count + 1);

    this.logger?.debug('Retry recorded', {
      taskId,
      attempt: count + 1,
      maxRetries: this.maxRetries,
      delayMs,
    });

    return delayMs;
  }

  /**
   * Get the current retry count for a task.
   */
  getRetryCount(taskId: string): number {
    return this.retryCounts.get(taskId) ?? 0;
  }

  /**
   * Get the total number of retries recorded across all tasks.
   */
  getTotalRetries(): number {
    let total = 0;
    for (const count of this.retryCounts.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Get the total LLM attempts for a task (1 initial + retries).
   * The cap is maxRetries + 1 (initial attempt).
   */
  getTotalAttempts(taskId: string): number {
    return 1 + (this.retryCounts.get(taskId) ?? 0);
  }

  /**
   * Reset retry counter for a task (e.g., after successful completion).
   */
  reset(taskId: string): void {
    this.retryCounts.delete(taskId);
  }
}
