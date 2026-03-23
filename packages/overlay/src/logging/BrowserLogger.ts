import type { ILogger } from '@novastorm-ai/core';

export class BrowserLogger implements ILogger {
  private readonly baseContext: Record<string, unknown>;

  constructor(baseContext?: Record<string, unknown>) {
    this.baseContext = baseContext ?? {};
  }

  debug(message: string, context?: Record<string, unknown>): void {
    console.debug(this.format(message, context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    console.info(this.format(message, context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(this.format(message, context));
  }

  error(message: string, context?: Record<string, unknown>): void {
    console.error(this.format(message, context));
  }

  child(context: Record<string, unknown>): ILogger {
    return new BrowserLogger({ ...this.baseContext, ...context });
  }

  private format(message: string, context?: Record<string, unknown>): string {
    const merged = { ...this.baseContext, ...context };
    const contextStr = Object.keys(merged).length > 0
      ? ` ${JSON.stringify(merged)}`
      : '';
    return `[Nova] ${message}${contextStr}`;
  }
}
