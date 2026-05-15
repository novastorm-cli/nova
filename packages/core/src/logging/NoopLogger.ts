import type { ILogger } from '../contracts/ILogger.js';

/**
 * Logger implementation that discards all messages.
 * Useful for tests and cases where logging is not needed.
 */
export class NoopLogger implements ILogger {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  debug(message: string, context?: Record<string, unknown>): void {
    // no-op
  }

  info(message: string, context?: Record<string, unknown>): void {
    // no-op
  }

  warn(message: string, context?: Record<string, unknown>): void {
    // no-op
  }

  error(message: string, context?: Record<string, unknown>): void {
    // no-op
  }

  child(context: Record<string, unknown>): ILogger {
    return this;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
