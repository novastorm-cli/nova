import { describe, it, expect, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
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

describe('GraphStore', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function createStore(): Promise<GraphStore> {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'graphstore-test-'));
    return new GraphStore(tmpDir);
  }

  // --- load ---

  it('load() returns empty array when file is missing', async () => {
    const store = await createStore();
    const result = await store.load();
    expect(result).toEqual([]);
  });

  it('load() returns empty array when file is empty', async () => {
    const store = await createStore();
    await fsp.writeFile(path.join(tmpDir, 'graph.json'), '', 'utf-8');
    const result = await store.load();
    expect(result).toEqual([]);
  });

  // --- save + load roundtrip ---

  it('save() + load() roundtrip preserves nodes', async () => {
    const store = await createStore();
    const nodes: DependencyNode[] = [
      makeNode({ filePath: 'src/a.ts', imports: ['src/b.ts'], exports: ['Foo'] }),
      makeNode({ filePath: 'src/b.ts', keywords: ['utils'] }),
    ];

    await store.save(nodes);
    const loaded = await store.load();

    expect(loaded).toEqual(nodes);
  });

  // --- upsertNode ---

  it('upsertNode() adds a new node', async () => {
    const store = await createStore();
    const node = makeNode({ filePath: 'src/new.ts', exports: ['NewThing'] });

    await store.upsertNode(node);
    const loaded = await store.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(node);
  });

  it('upsertNode() updates an existing node matched by filePath', async () => {
    const store = await createStore();
    const original = makeNode({ filePath: 'src/a.ts', exports: ['Old'] });
    await store.save([original]);

    const updated = makeNode({ filePath: 'src/a.ts', exports: ['New'], keywords: ['updated'] });
    await store.upsertNode(updated);
    const loaded = await store.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].exports).toEqual(['New']);
    expect(loaded[0].keywords).toEqual(['updated']);
  });

  // --- removeNode ---

  it('removeNode() removes a node by filePath', async () => {
    const store = await createStore();
    await store.save([
      makeNode({ filePath: 'src/a.ts' }),
      makeNode({ filePath: 'src/b.ts' }),
    ]);

    await store.removeNode('src/a.ts');
    const loaded = await store.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].filePath).toBe('src/b.ts');
  });

  it('removeNode() on nonexistent filePath is a no-op (no error)', async () => {
    const store = await createStore();
    await store.save([makeNode({ filePath: 'src/a.ts' })]);

    await expect(store.removeNode('src/nonexistent.ts')).resolves.toBeUndefined();

    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
  });

  // --- getImporters ---

  it('getImporters() finds all nodes importing the given file', async () => {
    const store = await createStore();
    await store.save([
      makeNode({ filePath: 'src/a.ts', imports: ['src/c.ts'] }),
      makeNode({ filePath: 'src/b.ts', imports: ['src/c.ts', 'src/d.ts'] }),
      makeNode({ filePath: 'src/c.ts', imports: [] }),
    ]);

    const importers = await store.getImporters('src/c.ts');

    expect(importers).toContain('src/a.ts');
    expect(importers).toContain('src/b.ts');
    expect(importers).toHaveLength(2);
  });

  // --- getImports ---

  it('getImports() returns the imports array for a node', async () => {
    const store = await createStore();
    await store.save([
      makeNode({ filePath: 'src/a.ts', imports: ['src/b.ts', 'src/c.ts'] }),
    ]);

    const imports = await store.getImports('src/a.ts');
    expect(imports).toEqual(['src/b.ts', 'src/c.ts']);
  });

  it('getImports() returns empty array for nonexistent file', async () => {
    const store = await createStore();
    const imports = await store.getImports('src/nonexistent.ts');
    expect(imports).toEqual([]);
  });

  // --- search ---

  it('search() finds nodes by keyword case-insensitive', async () => {
    const store = await createStore();
    await store.save([
      makeNode({ filePath: 'src/UserService.ts', keywords: ['user', 'auth'], exports: ['UserService'] }),
      makeNode({ filePath: 'src/utils.ts', keywords: ['helper'], exports: ['formatDate'] }),
    ]);

    const results = await store.search('USER');

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].filePath).toBe('src/UserService.ts');
  });

  it('search() sorts by match count (most matches first)', async () => {
    const store = await createStore();
    await store.save([
      makeNode({
        filePath: 'src/auth.ts',
        keywords: ['auth'],
        exports: ['login'],
      }),
      makeNode({
        filePath: 'src/auth-utils.ts',
        keywords: ['auth', 'authentication'],
        exports: ['AuthHelper'],
        route: '/auth/callback',
      }),
    ]);

    const results = await store.search('auth');

    expect(results.length).toBe(2);
    // auth-utils.ts has more matches (filePath, keywords x2, exports, route)
    expect(results[0].filePath).toBe('src/auth-utils.ts');
  });

  it('search() matches against filePath, keywords, exports, and route', async () => {
    const store = await createStore();
    await store.save([
      makeNode({ filePath: 'src/dashboard.ts', keywords: [], exports: [] }),
      makeNode({ filePath: 'src/x.ts', keywords: ['dashboard'], exports: [] }),
      makeNode({ filePath: 'src/y.ts', keywords: [], exports: ['Dashboard'] }),
      makeNode({ filePath: 'src/z.ts', keywords: [], exports: [], route: '/dashboard' }),
      makeNode({ filePath: 'src/unrelated.ts', keywords: ['other'], exports: ['Other'] }),
    ]);

    const results = await store.search('dashboard');

    const filePaths = results.map((n) => n.filePath);
    expect(filePaths).toContain('src/dashboard.ts');
    expect(filePaths).toContain('src/x.ts');
    expect(filePaths).toContain('src/y.ts');
    expect(filePaths).toContain('src/z.ts');
    expect(filePaths).not.toContain('src/unrelated.ts');
  });
});
