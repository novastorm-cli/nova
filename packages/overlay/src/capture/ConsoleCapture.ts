import type { IConsoleCapture } from '../contracts/ICapture.js';

const MAX_ERRORS = 20;

export class ConsoleCapture implements IConsoleCapture {
  private errors: string[] = [];
  private handlers: Array<(error: string) => void> = [];
  private installed = false;
  private originalError: typeof console.error = console.error;
  private originalWarn: typeof console.warn = console.warn;

  install(): void {
    if (this.installed) return;

    this.originalError = console.error;
    this.originalWarn = console.warn;

    console.error = (...args: unknown[]) => {
      this.originalError.apply(console, args);
      this.capture('error', args);
    };

    console.warn = (...args: unknown[]) => {
      this.originalWarn.apply(console, args);
      this.capture('warn', args);
    };

    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) return;

    console.error = this.originalError;
    console.warn = this.originalWarn;
    this.installed = false;
  }

  getErrors(): string[] {
    return [...this.errors].reverse();
  }

  onError(handler: (error: string) => void): void {
    this.handlers.push(handler);
  }

  private capture(level: string, args: unknown[]): void {
    const message = `[${level}] ${args.map((a) => this.stringify(a)).join(' ')}`;

    this.errors.push(message);
    if (this.errors.length > MAX_ERRORS) {
      this.errors.shift();
    }

    for (const handler of this.handlers) {
      handler(message);
    }
  }

  private stringify(value: unknown): string {
    if (value instanceof Error) {
      return value.stack ?? value.message;
    }
    if (typeof value === 'object' && value !== null) {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }
}
