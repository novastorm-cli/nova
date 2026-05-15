import { describe, it, expect, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { VectorStore } from '../VectorStore.js';
import type { EmbeddingRecord } from '../../models/types.js';

function makeRecord(overrides: Partial<EmbeddingRecord> & { id: string }): EmbeddingRecord {
  return {
    filePath: 'src/test.ts',
    chunkText: 'test code',
    embedding: [0.1, 0.2, 0.3],
    metadata: { type: 'general' },
    ...overrides,
  };
}

describe('VectorStore', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('upsert adds records and search returns them by similarity', () => {
    const store = new VectorStore();
    store.upsert(makeRecord({ id: 'a', embedding: [1, 0, 0] }));
    store.upsert(makeRecord({ id: 'b', embedding: [0, 1, 0] }));
    store.upsert(makeRecord({ id: 'c', embedding: [0.9, 0.1, 0] }));

    const results = store.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0]!.record.id).toBe('a');
    expect(results[1]!.record.id).toBe('c');
  });

  it('upsert updates existing record by id', () => {
    const store = new VectorStore();
    store.upsert(makeRecord({ id: 'x', chunkText: 'old' }));
    store.upsert(makeRecord({ id: 'x', chunkText: 'new' }));

    expect(store.getRecordCount()).toBe(1);
    const results = store.search([0.1, 0.2, 0.3], 1);
    expect(results[0]!.record.chunkText).toBe('new');
  });

  it('remove deletes all records for a file', () => {
    const store = new VectorStore();
    store.upsert(makeRecord({ id: 'a', filePath: 'src/a.ts' }));
    store.upsert(makeRecord({ id: 'b', filePath: 'src/a.ts' }));
    store.upsert(makeRecord({ id: 'c', filePath: 'src/b.ts' }));

    store.remove('src/a.ts');
    expect(store.getRecordCount()).toBe(1);
  });

  it('save and load persist records', async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vectorstore-test-'));
    const filePath = path.join(tmpDir, 'embeddings.json');

    const store1 = new VectorStore();
    store1.upsert(makeRecord({ id: 'a', embedding: [1, 0, 0] }));
    store1.upsert(makeRecord({ id: 'b', embedding: [0, 1, 0] }));
    await store1.save(filePath);

    const store2 = new VectorStore();
    await store2.load(filePath);
    expect(store2.getRecordCount()).toBe(2);

    const results = store2.search([1, 0, 0], 1);
    expect(results[0]!.record.id).toBe('a');
  });

  it('search returns empty array when no records', () => {
    const store = new VectorStore();
    const results = store.search([1, 0, 0], 5);
    expect(results).toEqual([]);
  });

  it('load handles missing file gracefully', async () => {
    const store = new VectorStore();
    await store.load('/nonexistent/path/embeddings.json');
    expect(store.getRecordCount()).toBe(0);
  });
});
