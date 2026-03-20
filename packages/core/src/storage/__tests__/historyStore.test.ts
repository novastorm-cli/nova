import { describe, it, expect, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { HistoryStore } from '../HistoryStore.js';
import type { HistoryEntry } from '../../models/types.js';

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: randomUUID(),
    taskId: randomUUID(),
    description: 'test task',
    type: 'single_file',
    lane: 1,
    status: 'running',
    filesChanged: ['src/a.ts'],
    startedAt: Date.now(),
    ...overrides,
  };
}

describe('HistoryStore', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function createStore(): Promise<HistoryStore> {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'historystore-test-'));
    return new HistoryStore(tmpDir);
  }

  // --- append + getAll ---

  it('append() creates a JSON file and getAll() reads it back', async () => {
    const store = await createStore();
    const entry = makeEntry();

    await store.append(entry);
    const all = await store.getAll();

    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(entry.id);
    expect(all[0].taskId).toBe(entry.taskId);
  });

  it('getAll() returns entries sorted by startedAt descending', async () => {
    const store = await createStore();
    const older = makeEntry({ startedAt: 1000 });
    const newer = makeEntry({ startedAt: 2000 });
    const middle = makeEntry({ startedAt: 1500 });

    await store.append(older);
    await store.append(newer);
    await store.append(middle);

    const all = await store.getAll();

    expect(all).toHaveLength(3);
    expect(all[0].startedAt).toBe(2000);
    expect(all[1].startedAt).toBe(1500);
    expect(all[2].startedAt).toBe(1000);
  });

  it('getAll() returns empty array when directory is missing', async () => {
    const store = new HistoryStore('/tmp/nonexistent-history-dir-' + randomUUID());
    const all = await store.getAll();
    expect(all).toEqual([]);
  });

  // --- getRecent ---

  it('getRecent(limit) returns first N entries', async () => {
    const store = await createStore();
    await store.append(makeEntry({ startedAt: 1000 }));
    await store.append(makeEntry({ startedAt: 2000 }));
    await store.append(makeEntry({ startedAt: 3000 }));

    const recent = await store.getRecent(2);

    expect(recent).toHaveLength(2);
    expect(recent[0].startedAt).toBe(3000);
    expect(recent[1].startedAt).toBe(2000);
  });

  // --- getSince ---

  it('getSince(timestamp) filters entries by startedAt', async () => {
    const store = await createStore();
    await store.append(makeEntry({ startedAt: 1000 }));
    await store.append(makeEntry({ startedAt: 2000 }));
    await store.append(makeEntry({ startedAt: 3000 }));

    const since = await store.getSince(2000);

    expect(since).toHaveLength(2);
    expect(since.every((e) => e.startedAt >= 2000)).toBe(true);
  });

  // --- getByTaskId ---

  it('getByTaskId() finds an entry by taskId', async () => {
    const store = await createStore();
    const entry = makeEntry();
    await store.append(entry);

    const found = await store.getByTaskId(entry.taskId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entry.id);
  });

  it('getByTaskId() returns null for nonexistent taskId', async () => {
    const store = await createStore();
    const found = await store.getByTaskId('nonexistent');
    expect(found).toBeNull();
  });

  // --- clear ---

  it('clear() removes all entries', async () => {
    const store = await createStore();
    await store.append(makeEntry());
    await store.append(makeEntry());

    await store.clear();
    const all = await store.getAll();

    expect(all).toEqual([]);
  });

  it('clear() on empty directory is a no-op', async () => {
    const store = await createStore();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
