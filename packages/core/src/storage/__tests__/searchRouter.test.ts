import { describe, it, expect, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SearchRouter } from '../SearchRouter.js';
import { GraphStore } from '../GraphStore.js';
import type { DependencyNode } from '../../models/types.js';

function makeNode(overrides: Partial<DependencyNode> & { filePath: string }): DependencyNode {
  return {
    imports: [],
    exports: [],
    type: 'util',
    keywords: [],
    ...overrides,
  };
}

describe('SearchRouter', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function createRouter(nodes: DependencyNode[] = []): Promise<SearchRouter> {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'searchrouter-test-'));
    const graphStore = new GraphStore(tmpDir);
    if (nodes.length > 0) {
      await graphStore.save(nodes);
    }
    return new SearchRouter(graphStore);
  }

  it('search() returns SearchResult[] with matchType', async () => {
    const router = await createRouter([
      makeNode({ filePath: 'src/user.ts', keywords: ['user'], exports: ['User'] }),
    ]);

    const results = await router.search('user');

    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const result of results) {
      expect(result).toHaveProperty('filePath');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('matchType');
      expect(['graph', 'keyword', 'semantic']).toContain(result.matchType);
    }
  });

  it('search() deduplicates by filePath', async () => {
    // Create nodes where graph traversal might return the same file
    // through different paths (direct match + importer traversal)
    const router = await createRouter([
      makeNode({
        filePath: 'src/auth.ts',
        keywords: ['auth'],
        exports: ['Auth'],
        imports: ['src/user.ts'],
      }),
      makeNode({
        filePath: 'src/user.ts',
        keywords: ['user', 'auth'],
        exports: ['User'],
      }),
    ]);

    const results = await router.search('auth');

    const filePaths = results.map((r) => r.filePath);
    const uniqueFilePaths = [...new Set(filePaths)];
    expect(filePaths).toEqual(uniqueFilePaths);
  });

  it('search() respects limit parameter', async () => {
    const nodes = Array.from({ length: 20 }, (_, i) =>
      makeNode({
        filePath: `src/file${i}.ts`,
        keywords: ['common'],
        exports: [`Export${i}`],
      }),
    );

    const router = await createRouter(nodes);
    const results = await router.search('common', 3);

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('search() returns empty array when no matches', async () => {
    const router = await createRouter([
      makeNode({ filePath: 'src/a.ts', keywords: ['alpha'] }),
    ]);

    const results = await router.search('zzz-nonexistent');
    expect(results).toEqual([]);
  });

  it('search() uses default limit of 10 when not specified', async () => {
    const nodes = Array.from({ length: 25 }, (_, i) =>
      makeNode({
        filePath: `src/item${i}.ts`,
        keywords: ['shared'],
      }),
    );

    const router = await createRouter(nodes);
    const results = await router.search('shared');

    expect(results.length).toBeLessThanOrEqual(10);
  });
});
