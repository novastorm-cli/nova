import { describe, it, expect } from 'vitest';
import { NovaEventSchema, parseNovaEvent } from '../eventSchemas.js';

describe('NovaEventSchema', () => {
  it('should parse observation event', () => {
    const event = {
      type: 'observation',
      data: {
        screenshot: Buffer.alloc(0),
        currentUrl: 'http://localhost:3000',
        timestamp: Date.now(),
      },
    };
    expect(() => parseNovaEvent(event)).not.toThrow();
  });

  it('should parse task_created event', () => {
    const event = {
      type: 'task_created',
      data: {
        id: '1',
        description: 'test task',
        files: ['file.ts'],
        type: 'single_file',
        lane: 1,
        status: 'pending',
      },
    };
    expect(() => parseNovaEvent(event)).not.toThrow();
  });

  it('should parse task_started event', () => {
    expect(() => parseNovaEvent({ type: 'task_started', data: { taskId: '1' } })).not.toThrow();
  });

  it('should parse task_completed event', () => {
    expect(() => parseNovaEvent({
      type: 'task_completed',
      data: { taskId: '1', diff: '+line', commitHash: 'abc1234' },
    })).not.toThrow();
  });

  it('should parse task_failed event', () => {
    expect(() => parseNovaEvent({
      type: 'task_failed',
      data: { taskId: '1', error: 'something broke' },
    })).not.toThrow();
  });

  it('should parse file_changed event', () => {
    expect(() => parseNovaEvent({
      type: 'file_changed',
      data: { filePath: 'src/index.ts', source: 'nova' },
    })).not.toThrow();
  });

  it('should parse index_updated event', () => {
    expect(() => parseNovaEvent({
      type: 'index_updated',
      data: { filesChanged: ['a.ts', 'b.ts'] },
    })).not.toThrow();
  });

  it('should parse status event', () => {
    expect(() => parseNovaEvent({
      type: 'status',
      data: { message: 'working...' },
    })).not.toThrow();
  });

  it('should parse confirm event', () => {
    expect(() => parseNovaEvent({ type: 'confirm', data: {} })).not.toThrow();
  });

  it('should parse cancel event', () => {
    expect(() => parseNovaEvent({ type: 'cancel', data: {} })).not.toThrow();
  });

  it('should parse llm_chunk event', () => {
    expect(() => parseNovaEvent({
      type: 'llm_chunk',
      data: { text: 'hello', phase: 'code' },
    })).not.toThrow();
  });

  it('should parse secrets_required event', () => {
    expect(() => parseNovaEvent({
      type: 'secrets_required',
      data: { envVars: ['API_KEY'], taskId: '1' },
    })).not.toThrow();
  });

  it('should parse analysis_complete event', () => {
    expect(() => parseNovaEvent({
      type: 'analysis_complete',
      data: { fileCount: 10, methodCount: 50 },
    })).not.toThrow();
  });

  it('should reject invalid event type', () => {
    expect(() => parseNovaEvent({ type: 'unknown', data: {} })).toThrow();
  });

  it('should reject event with missing data', () => {
    expect(() => parseNovaEvent({ type: 'task_started' })).toThrow();
  });

  it('should reject event with wrong data shape', () => {
    expect(() => parseNovaEvent({
      type: 'task_completed',
      data: { taskId: 123 }, // taskId should be string, missing diff and commitHash
    })).toThrow();
  });
});
