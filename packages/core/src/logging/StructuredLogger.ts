import { ILogger, LogLevel } from '../contracts/ILogger.js';

export interface StructuredLoggerOptions {
  minLevel?: LogLevel;
  isTTY?: boolean;
}

export class StructuredLogger implements ILogger {
  private readonly minLevel: LogLevel;
  private readonly isTTY: boolean;
  private readonly baseContext: Record<string, unknown>;

  constructor(
    options?: StructuredLoggerOptions,
    baseContext?: Record<string, unknown>,
  ) {
    this.minLevel = options?.minLevel ?? LogLevel.INFO;
    this.isTTY = options?.isTTY ?? (process.stderr?.isTTY ?? false);
    this.baseContext = baseContext ?? {};
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context);
  }

  child(context: Record<string, unknown>): ILogger {
    return new StructuredLogger(
      { minLevel: this.minLevel, isTTY: this.isTTY },
      { ...this.baseContext, ...context },
    );
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (level < this.minLevel) return;

    const merged = { ...this.baseContext, ...context };

    if (this.isTTY) {
      this.writeTTY(level, message, merged);
    } else {
      this.writeJSON(level, message, merged);
    }
  }

  private writeJSON(level: LogLevel, message: string, context: Record<string, unknown>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message,
      ...(Object.keys(context).length > 0 ? context : {}),
    };
    process.stderr.write(JSON.stringify(entry) + '\n');
  }

  private writeTTY(level: LogLevel, message: string, context: Record<string, unknown>): void {
    const colors: Record<number, string> = {
      [LogLevel.DEBUG]: '\x1b[90m',  // gray
      [LogLevel.INFO]: '\x1b[36m',   // cyan
      [LogLevel.WARN]: '\x1b[33m',   // yellow
      [LogLevel.ERROR]: '\x1b[31m',  // red
    };
    const reset = '\x1b[0m';
    const color = colors[level] ?? '';
    const levelName = LogLevel[level]?.padEnd(5) ?? 'UNKNOWN';

    const contextStr = Object.keys(context).length > 0
      ? ` ${JSON.stringify(context)}`
      : '';

    process.stderr.write(`${color}${levelName}${reset} ${message}${contextStr}\n`);
  }
}
