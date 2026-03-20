import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NovaEventBus } from '../../events/EventBus.js';
import { HistoryRecorder } from '../HistoryRecorder.js';
import type { IHistoryStore } from '../../contracts/IStorage.js';
import type { HistoryEntry } from '../../models/types.js';

function createMockHistoryStore(): IHistoryStore {
  const entries: HistoryEntry[] = [];
  return {
    append: vi.fn(async (entry: HistoryEntry) => {
      entries.push(entry);
    }),
    getAll: vi.fn(async () => [...entries]),
    getRecent: vi.fn(async (limit: number) => entries.slice(0, limit)),
    getSince: vi.fn(async (ts: number) => entries.filter((e) => e.startedAt >= ts)),
    getByTaskId: vi.fn(async (taskId: string) => entries.find((e) => e.taskId === taskId) ?? null),
    clear: vi.fn(async () => { entries.length = 0; }),
  };
}

describe('HistoryRecorder', () => {
  let eventBus: NovaEventBus;
  let store: IHistoryStore;
  let recorder: HistoryRecorder;

  beforeEach(() => {
    eventBus = new NovaEventBus();
    store = createMockHistoryStore();
    recorder = new HistoryRecorder(store, eventBus);
  });

  it('records a running entry on task_started', async () => {
    recorder.start();

    eventBus.emit({
      type: 'task_created',
      data: {
        id: 'task-1',
        description: 'Add button',
        files: ['src/Button.tsx'],
        type: 'single_file',
        lane: 1,
        status: 'pending',
      },
    });

    eventBus.emit({ type: 'task_started', data: { taskId: 'task-1' } });

    // Wait for async append
    await vi.waitFor(() => {
      expect(store.append).toHaveBeenCalledOnce();
    });

    const call = vi.mocked(store.append).mock.calls[0][0];
    expect(call.taskId).toBe('task-1');
    expect(call.status).toBe('running');
    expect(call.description).toBe('Add button');
    expect(call.filesChanged).toEqual(['src/Button.tsx']);
  });

  it('updates entry on task_completed', async () => {
    recorder.start();

    eventBus.emit({
      type: 'task_created',
      data: {
        id: 'task-2',
        description: 'Fix CSS',
        files: ['src/styles.css'],
        type: 'css',
        lane: 1,
        status: 'pending',
      },
    });

    eventBus.emit({ type: 'task_started', data: { taskId: 'task-2' } });

    await vi.waitFor(() => {
      expect(store.append).toHaveBeenCalledOnce();
    });

    eventBus.emit({
      type: 'task_completed',
      data: { taskId: 'task-2', diff: '--- a\n+++ b', commitHash: 'abc123' },
    });

    await vi.waitFor(() => {
      expect(store.append).toHaveBeenCalledTimes(2);
    });

    const secondCall = vi.mocked(store.append).mock.calls[1][0];
    expect(secondCall.status).toBe('done');
    expect(secondCall.commitHash).toBe('abc123');
    expect(secondCall.diff).toBe('--- a\n+++ b');
    expect(secondCall.completedAt).toBeDefined();
  });

  it('updates entry on task_failed', async () => {
    recorder.start();

    eventBus.emit({
      type: 'task_created',
      data: {
        id: 'task-3',
        description: 'Refactor module',
        files: ['src/mod.ts'],
        type: 'refactor',
        lane: 2,
        status: 'pending',
      },
    });

    eventBus.emit({ type: 'task_started', data: { taskId: 'task-3' } });

    await vi.waitFor(() => {
      expect(store.append).toHaveBeenCalledOnce();
    });

    eventBus.emit({
      type: 'task_failed',
      data: { taskId: 'task-3', error: 'Compilation failed' },
    });

    await vi.waitFor(() => {
      expect(store.append).toHaveBeenCalledTimes(2);
    });

    const secondCall = vi.mocked(store.append).mock.calls[1][0];
    expect(secondCall.status).toBe('failed');
    expect(secondCall.error).toBe('Compilation failed');
    expect(secondCall.completedAt).toBeDefined();
  });

  it('stop() unsubscribes from all events', async () => {
    recorder.start();
    recorder.stop();

    eventBus.emit({
      type: 'task_created',
      data: {
        id: 'task-4',
        description: 'test',
        files: [],
        type: 'single_file',
        lane: 1,
        status: 'pending',
      },
    });

    eventBus.emit({ type: 'task_started', data: { taskId: 'task-4' } });

    // Give async a chance to run
    await new Promise((r) => setTimeout(r, 50));

    expect(store.append).not.toHaveBeenCalled();
  });
});
