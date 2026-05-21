import { describe, it, expect } from 'vitest';
import { parseNovaEvent } from '../eventSchemas.js';

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

  it('should parse task_created event with lane 5', () => {
    const event = {
      type: 'task_created',
      data: {
        id: '2',
        description: 'mission task',
        files: ['app/page.tsx'],
        type: 'multi_file',
        lane: 5,
        status: 'pending',
      },
    };
    expect(() => parseNovaEvent(event)).not.toThrow();
  });

  it('should parse task_started event', () => {
    expect(() => parseNovaEvent({ type: 'task_started', data: { taskId: '1' } })).not.toThrow();
  });

  it('should parse task_completed event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'task_completed',
        data: { taskId: '1', diff: '+line', commitHash: 'abc1234' },
      }),
    ).not.toThrow();
  });

  it('should parse task_failed event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'task_failed',
        data: { taskId: '1', error: 'something broke' },
      }),
    ).not.toThrow();
  });

  it('should parse file_changed event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'file_changed',
        data: { filePath: 'src/index.ts', source: 'nova' },
      }),
    ).not.toThrow();
  });

  it('should parse index_updated event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'index_updated',
        data: { filesChanged: ['a.ts', 'b.ts'] },
      }),
    ).not.toThrow();
  });

  it('should parse status event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'status',
        data: { message: 'working...' },
      }),
    ).not.toThrow();
  });

  it('should parse confirm event', () => {
    expect(() => parseNovaEvent({ type: 'confirm', data: {} })).not.toThrow();
  });

  it('should parse cancel event', () => {
    expect(() => parseNovaEvent({ type: 'cancel', data: {} })).not.toThrow();
  });

  it('should parse llm_chunk event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'llm_chunk',
        data: { text: 'hello', phase: 'code' },
      }),
    ).not.toThrow();
  });

  it('should parse secrets_required event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'secrets_required',
        data: { envVars: ['API_KEY'], taskId: '1' },
      }),
    ).not.toThrow();
  });

  it('should parse analysis_complete event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'analysis_complete',
        data: { fileCount: 10, methodCount: 50 },
      }),
    ).not.toThrow();
  });

  it('should parse provider_retry event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'provider_retry',
        data: { attempt: 1, waitMs: 1000, reason: 'rate_limit' },
      }),
    ).not.toThrow();
  });

  it('should parse provider_fallback event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'provider_fallback',
        data: { fromModel: 'gpt-4o', toModel: 'gpt-4o-mini', reason: 'All retries exhausted' },
      }),
    ).not.toThrow();
  });

  // Mission events
  it('should parse mission_planned event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'mission_planned',
        data: {
          taskId: 'task-1',
          plan: {
            features: [
              {
                id: 'feat-1',
                description: 'Add login form',
                files: ['app/login/page.tsx'],
                type: 'multi_file',
                dependencies: [],
              },
            ],
          },
        },
      }),
    ).not.toThrow();
  });

  it('should parse mission_subtask_started event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'mission_subtask_started',
        data: { taskId: 'task-1', featureId: 'feat-1', description: 'Add login form' },
      }),
    ).not.toThrow();
  });

  it('should parse mission_subtask_completed event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'mission_subtask_completed',
        data: {
          taskId: 'task-1',
          featureId: 'feat-1',
          result: {
            success: true,
            featureId: 'feat-1',
            diff: '+import React',
            generatedFiles: [{ path: 'app/login/page.tsx', content: 'code' }],
          },
        },
      }),
    ).not.toThrow();
  });

  it('should parse mission_director_review event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'mission_director_review',
        data: {
          taskId: 'task-1',
          verdict: {
            decision: 'APPROVED',
            feedback: [],
          },
        },
      }),
    ).not.toThrow();
  });

  it('should parse mission_iteration event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'mission_iteration',
        data: { taskId: 'task-1', iteration: 2, maxIterations: 5 },
      }),
    ).not.toThrow();
  });

  it('should parse mission_completed event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'mission_completed',
        data: { taskId: 'task-1', commitHash: 'abc1234' },
      }),
    ).not.toThrow();
  });

  it('should parse mission_failed event', () => {
    expect(() =>
      parseNovaEvent({
        type: 'mission_failed',
        data: { taskId: 'task-1', error: 'Director rejected plan' },
      }),
    ).not.toThrow();
  });

  it('should reject invalid event type', () => {
    expect(() => parseNovaEvent({ type: 'unknown', data: {} })).toThrow();
  });

  it('should reject event with missing data', () => {
    expect(() => parseNovaEvent({ type: 'task_started' })).toThrow();
  });

  it('should reject event with wrong data shape', () => {
    expect(() =>
      parseNovaEvent({
        type: 'task_completed',
        data: { taskId: 123 }, // taskId should be string, missing diff and commitHash
      }),
    ).toThrow();
  });
});
