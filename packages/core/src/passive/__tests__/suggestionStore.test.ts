import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SuggestionStore } from '../SuggestionStore.js';
import type { PassiveSuggestion, BehaviorPattern } from '../../models/types.js';

function createPattern(): BehaviorPattern {
  return {
    id: 'pat-1',
    type: 'frequent_page',
    description: 'Test pattern',
    confidence: 0.8,
    occurrences: 5,
    firstSeen: 1000,
    lastSeen: 2000,
    metadata: { url: '/dashboard' },
  };
}

function createSuggestion(overrides: Partial<PassiveSuggestion> = {}): PassiveSuggestion {
  return {
    id: 'sug-' + Math.random().toString(36).slice(2, 8),
    pattern: createPattern(),
    title: 'Test suggestion',
    description: 'Test description',
    suggestedTasks: [{ description: 'Do something', type: 'single_file', estimatedLane: 1 }],
    status: 'pending',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('SuggestionStore', () => {
  let tmpDir: string;
  let store: SuggestionStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'nova-suggestion-store-'));
    store = new SuggestionStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should save and load a suggestion', async () => {
    const suggestion = createSuggestion({ id: 'test-1' });
    await store.save(suggestion);

    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('test-1');
    expect(loaded[0].title).toBe('Test suggestion');
  });

  it('should load multiple suggestions', async () => {
    await store.save(createSuggestion({ id: 'a' }));
    await store.save(createSuggestion({ id: 'b' }));
    await store.save(createSuggestion({ id: 'c' }));

    const loaded = await store.load();
    expect(loaded).toHaveLength(3);
  });

  it('should return empty array when no suggestions exist', async () => {
    const loaded = await store.load();
    expect(loaded).toEqual([]);
  });

  it('should update suggestion status', async () => {
    const suggestion = createSuggestion({ id: 'upd-1' });
    await store.save(suggestion);

    await store.update('upd-1', 'approved');

    const loaded = await store.load();
    expect(loaded[0].status).toBe('approved');
    expect(loaded[0].respondedAt).toBeDefined();
  });

  it('should not throw when updating non-existent suggestion', async () => {
    await expect(store.update('non-existent', 'rejected')).resolves.not.toThrow();
  });

  it('should cleanup suggestions older than threshold', async () => {
    const oldSuggestion = createSuggestion({ id: 'old', createdAt: Date.now() - 100_000 });
    const newSuggestion = createSuggestion({ id: 'new', createdAt: Date.now() });

    await store.save(oldSuggestion);
    await store.save(newSuggestion);

    await store.cleanup(50_000); // Remove anything older than 50s

    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('new');
  });
});
