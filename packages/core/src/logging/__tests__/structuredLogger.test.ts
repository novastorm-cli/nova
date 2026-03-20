import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StructuredLogger } from '../StructuredLogger.js';
import { LogLevel } from '../../contracts/ILogger.js';

describe('StructuredLogger', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let writeSpy: any;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should write JSON lines when not TTY', () => {
    const logger = new StructuredLogger({ isTTY: false, minLevel: LogLevel.DEBUG });
    logger.info('hello', { key: 'value' });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('INFO');
    expect(parsed.message).toBe('hello');
    expect(parsed.key).toBe('value');
    expect(parsed.timestamp).toBeDefined();
  });

  it('should filter messages below minLevel', () => {
    const logger = new StructuredLogger({ isTTY: false, minLevel: LogLevel.WARN });
    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('visible');

    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it('should create child logger with merged context', () => {
    const logger = new StructuredLogger({ isTTY: false, minLevel: LogLevel.DEBUG });
    const child = logger.child({ correlationId: 'abc' });
    child.info('test');

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.correlationId).toBe('abc');
  });

  it('should merge child context with message context', () => {
    const logger = new StructuredLogger({ isTTY: false, minLevel: LogLevel.DEBUG });
    const child = logger.child({ component: 'ws' });
    child.error('fail', { code: 500 });

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.component).toBe('ws');
    expect(parsed.code).toBe(500);
    expect(parsed.level).toBe('ERROR');
  });

  it('should write colored text when TTY', () => {
    const logger = new StructuredLogger({ isTTY: true, minLevel: LogLevel.DEBUG });
    logger.warn('caution');

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('WARN');
    expect(output).toContain('caution');
    // Should contain ANSI color codes
    expect(output).toContain('\x1b[');
  });

  it('should support all log levels', () => {
    const logger = new StructuredLogger({ isTTY: false, minLevel: LogLevel.DEBUG });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(writeSpy).toHaveBeenCalledTimes(4);
    const levels = writeSpy.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string).level);
    expect(levels).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);
  });
});
