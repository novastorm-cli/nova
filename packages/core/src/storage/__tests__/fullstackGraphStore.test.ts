import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { FullstackGraphStore } from '../FullstackGraphStore.js';
import type { FullstackGraph, FullstackNode, FullstackEdge } from '../../models/types.js';

function makeNode(overrides: Partial<FullstackNode> & { id: string }): FullstackNode {
  return {
    name: overrides.id.split(':')[1] ?? overrides.id,
    filePath: overrides.id.split(':')[0] ?? '',
    type: 'component',
    layer: 'frontend',
    metadata: {},
    ...overrides,
  };
}

function makeEdge(overrides: Partial<FullstackEdge> & { from: string; to: string }): FullstackEdge {
  return {
    type: 'fetches',
    ...overrides,
  };
}

describe('FullstackGraphStore', () => {
  let tmpDir: string;
  let store: FullstackGraphStore;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fsgraphstore-test-'));
    store = new FullstackGraphStore(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // --- load ---

  it('load() returns empty graph when file is missing', async () => {
    const graph = await store.load();
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it('load() returns empty graph for invalid JSON', async () => {
    await fsp.writeFile(path.join(tmpDir, 'fullstack-graph.json'), 'not json', 'utf-8');
    const graph = await store.load();
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  // --- save + load roundtrip ---

  it('save() + load() roundtrip preserves graph', async () => {
    const graph: FullstackGraph = {
      nodes: [
        makeNode({ id: 'src/App.tsx:App', type: 'component', layer: 'frontend' }),
        makeNode({ id: 'api/route.ts:GET', type: 'api_endpoint', layer: 'backend' }),
        makeNode({ id: 'schema.prisma:User', type: 'db_model', layer: 'database' }),
      ],
      edges: [
        makeEdge({ from: 'src/App.tsx:App', to: 'api/route.ts:GET', type: 'fetches' }),
        makeEdge({ from: 'api/route.ts:GET', to: 'schema.prisma:User', type: 'queries' }),
      ],
    };

    await store.save(graph);
    const loaded = await store.load();

    expect(loaded.nodes).toEqual(graph.nodes);
    expect(loaded.edges).toEqual(graph.edges);
  });

  // --- getRelatedNodes ---

  it('getRelatedNodes() returns upstream and downstream', async () => {
    const graph: FullstackGraph = {
      nodes: [
        makeNode({ id: 'a:A', layer: 'frontend' }),
        makeNode({ id: 'b:B', layer: 'backend' }),
        makeNode({ id: 'c:C', layer: 'database' }),
      ],
      edges: [
        makeEdge({ from: 'a:A', to: 'b:B', type: 'fetches' }),
        makeEdge({ from: 'b:B', to: 'c:C', type: 'queries' }),
      ],
    };

    await store.save(graph);
    await store.load();

    const related = store.getRelatedNodes('b:B');
    expect(related.upstream).toHaveLength(1);
    expect(related.upstream[0]!.id).toBe('a:A');
    expect(related.downstream).toHaveLength(1);
    expect(related.downstream[0]!.id).toBe('c:C');
  });

  // --- getNodesByLayer ---

  it('getNodesByLayer() filters by layer', async () => {
    const graph: FullstackGraph = {
      nodes: [
        makeNode({ id: 'a:A', layer: 'frontend' }),
        makeNode({ id: 'b:B', layer: 'backend' }),
        makeNode({ id: 'c:C', layer: 'frontend' }),
        makeNode({ id: 'd:D', layer: 'database' }),
      ],
      edges: [],
    };

    await store.save(graph);
    await store.load();

    expect(store.getNodesByLayer('frontend')).toHaveLength(2);
    expect(store.getNodesByLayer('backend')).toHaveLength(1);
    expect(store.getNodesByLayer('database')).toHaveLength(1);
  });

  // --- getPathFromFrontendToDb ---

  it('getPathFromFrontendToDb() traces component -> API -> model', async () => {
    const graph: FullstackGraph = {
      nodes: [
        makeNode({ id: 'comp.tsx:UserList', layer: 'frontend', type: 'component' }),
        makeNode({ id: 'route.ts:GET', layer: 'backend', type: 'api_endpoint' }),
        makeNode({ id: 'schema:User', layer: 'database', type: 'db_model' }),
      ],
      edges: [
        makeEdge({ from: 'comp.tsx:UserList', to: 'route.ts:GET', type: 'fetches' }),
        makeEdge({ from: 'route.ts:GET', to: 'schema:User', type: 'queries' }),
      ],
    };

    await store.save(graph);
    await store.load();

    const tracedPath = store.getPathFromFrontendToDb('comp.tsx:UserList');
    expect(tracedPath).toHaveLength(3);
    expect(tracedPath[0]!.id).toBe('comp.tsx:UserList');
    expect(tracedPath[1]!.id).toBe('route.ts:GET');
    expect(tracedPath[2]!.id).toBe('schema:User');
  });

  it('getPathFromFrontendToDb() returns empty for non-frontend node', async () => {
    const graph: FullstackGraph = {
      nodes: [makeNode({ id: 'route.ts:GET', layer: 'backend', type: 'api_endpoint' })],
      edges: [],
    };

    await store.save(graph);
    await store.load();

    expect(store.getPathFromFrontendToDb('route.ts:GET')).toEqual([]);
  });

  it('getPathFromFrontendToDb() returns empty for unknown node', async () => {
    await store.save({ nodes: [], edges: [] });
    await store.load();

    expect(store.getPathFromFrontendToDb('unknown:id')).toEqual([]);
  });

  // --- getAffectedNodes ---

  it('getAffectedNodes() returns connected subgraph', async () => {
    const graph: FullstackGraph = {
      nodes: [
        makeNode({ id: 'a.tsx:A', filePath: 'a.tsx', layer: 'frontend' }),
        makeNode({ id: 'b.ts:B', filePath: 'b.ts', layer: 'backend' }),
        makeNode({ id: 'c.prisma:C', filePath: 'c.prisma', layer: 'database' }),
        makeNode({ id: 'd.tsx:D', filePath: 'd.tsx', layer: 'frontend' }), // disconnected
      ],
      edges: [
        makeEdge({ from: 'a.tsx:A', to: 'b.ts:B', type: 'fetches' }),
        makeEdge({ from: 'b.ts:B', to: 'c.prisma:C', type: 'queries' }),
      ],
    };

    await store.save(graph);
    await store.load();

    const affected = store.getAffectedNodes('a.tsx');
    const ids = affected.map((n) => n.id);
    expect(ids).toContain('a.tsx:A');
    expect(ids).toContain('b.ts:B');
    expect(ids).toContain('c.prisma:C');
    expect(ids).not.toContain('d.tsx:D');
  });

  it('getAffectedNodes() returns empty for unknown filePath', async () => {
    await store.save({ nodes: [], edges: [] });
    await store.load();

    expect(store.getAffectedNodes('nonexistent.ts')).toEqual([]);
  });

  it('getAffectedNodes() traverses edges bidirectionally', async () => {
    const graph: FullstackGraph = {
      nodes: [
        makeNode({ id: 'a.tsx:A', filePath: 'a.tsx', layer: 'frontend' }),
        makeNode({ id: 'b.ts:B', filePath: 'b.ts', layer: 'backend' }),
      ],
      edges: [makeEdge({ from: 'a.tsx:A', to: 'b.ts:B', type: 'fetches' })],
    };

    await store.save(graph);
    await store.load();

    // Starting from the target node should also find the source
    const affected = store.getAffectedNodes('b.ts');
    const ids = affected.map((n) => n.id);
    expect(ids).toContain('a.tsx:A');
    expect(ids).toContain('b.ts:B');
  });
});
