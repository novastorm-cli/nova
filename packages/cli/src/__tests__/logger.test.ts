import { describe, it, expect, vi } from 'vitest';
import type { ILogger } from '@novastorm-ai/core';
import type { Observation, TaskItem } from '@novastorm-ai/core';
import { NovaLogger } from '../logger.js';

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    }),
  };
}

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    screenshot: Buffer.from('test'),
    currentUrl: 'http://localhost:3000',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-1',
    description: 'test task',
    lane: 2,
    files: ['src/test.ts'],
    ...overrides,
  } as TaskItem;
}

describe('NovaLogger', () => {
  it('uses provided logger', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logObservation(makeObservation());
    expect(mock.info).toHaveBeenCalled();
  });

  it('defaults to StructuredLogger when no logger provided', () => {
    const logger = new NovaLogger();
    expect(logger).toBeInstanceOf(NovaLogger);
  });

  it('logObservation includes url and action', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logObservation(
      makeObservation({ transcript: 'click button', currentUrl: 'http://example.com' }),
    );
    expect(mock.info).toHaveBeenCalledWith(
      expect.stringContaining('click button'),
      expect.any(Object),
    );
  });

  it('logObservation uses "click" when no transcript', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logObservation(makeObservation({ transcript: undefined }));
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('click'), expect.any(Object));
  });

  it('logObservation uses "(unknown)" when no url', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logObservation(makeObservation({ currentUrl: '' }));
    expect(mock.info).toHaveBeenCalledWith(
      expect.stringContaining('(unknown)'),
      expect.any(Object),
    );
  });

  it('logAnalyzing with transcript', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logAnalyzing('hello');
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('hello'));
  });

  it('logAnalyzing without transcript', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logAnalyzing();
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('Analyzing'));
  });

  it('logTasks logs task count and descriptions', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    const tasks = [
      makeTask({ description: 'add button', lane: 2 }),
      makeTask({ id: 'task-2', description: 'fix bug', lane: 3 }),
    ];
    logger.logTasks(tasks);
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('2 task(s)'));
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('add button'));
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('fix bug'));
  });

  it('logTaskStarted logs description and lane', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logTaskStarted(makeTask({ description: 'hello', lane: 2 }));
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('hello'));
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('Lane 2'));
  });

  it('logTaskCompleted logs description', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logTaskCompleted(makeTask({ description: 'done', commitHash: 'abc123' }));
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('done'));
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('abc123'));
  });

  it('logTaskCompleted shows "no hash" when commitHash missing', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logTaskCompleted(makeTask({ commitHash: undefined }));
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('no hash'));
  });

  it('logTaskFailed logs error', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logTaskFailed(makeTask({ description: 'fail', error: 'something went wrong' }));
    expect(mock.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
    expect(mock.error).toHaveBeenCalledWith(expect.stringContaining('something went wrong'));
  });

  it('logTaskFailed shows "unknown error" when error missing', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logTaskFailed(makeTask({ error: undefined }));
    expect(mock.error).toHaveBeenCalledWith(expect.stringContaining('unknown error'));
  });

  it('logFileChanged logs file path', () => {
    const mock = createMockLogger();
    const logger = new NovaLogger(mock);
    logger.logFileChanged('src/index.ts');
    expect(mock.info).toHaveBeenCalledWith(expect.stringContaining('src/index.ts'));
  });
});
