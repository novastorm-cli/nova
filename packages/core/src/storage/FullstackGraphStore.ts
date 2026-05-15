import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { FullstackGraph, FullstackNode } from '../models/types.js';

const FULLSTACK_GRAPH_FILE = 'fullstack-graph.json';

export class FullstackGraphStore {
  private readonly graphPath: string;
  private graph: FullstackGraph = { nodes: [], edges: [] };

  constructor(novaPath: string) {
    this.graphPath = join(novaPath, FULLSTACK_GRAPH_FILE);
  }

  async load(): Promise<FullstackGraph> {
    try {
      const raw = await readFile(this.graphPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'nodes' in parsed &&
        'edges' in parsed &&
        Array.isArray((parsed as FullstackGraph).nodes) &&
        Array.isArray((parsed as FullstackGraph).edges)
      ) {
        this.graph = parsed as FullstackGraph;
        return this.graph;
      }
      this.graph = { nodes: [], edges: [] };
      return this.graph;
    } catch {
      this.graph = { nodes: [], edges: [] };
      return this.graph;
    }
  }

  async save(graph: FullstackGraph): Promise<void> {
    this.graph = graph;
    await mkdir(dirname(this.graphPath), { recursive: true });
    await writeFile(this.graphPath, JSON.stringify(graph, null, 2), 'utf-8');
  }

  getRelatedNodes(nodeId: string): { upstream: FullstackNode[]; downstream: FullstackNode[] } {
    const nodeMap = new Map(this.graph.nodes.map((n) => [n.id, n]));

    const upstream: FullstackNode[] = [];
    const downstream: FullstackNode[] = [];

    for (const edge of this.graph.edges) {
      if (edge.to === nodeId) {
        const node = nodeMap.get(edge.from);
        if (node) upstream.push(node);
      }
      if (edge.from === nodeId) {
        const node = nodeMap.get(edge.to);
        if (node) downstream.push(node);
      }
    }

    return { upstream, downstream };
  }

  getNodesByLayer(layer: 'frontend' | 'backend' | 'database'): FullstackNode[] {
    return this.graph.nodes.filter((n) => n.layer === layer);
  }

  getPathFromFrontendToDb(componentId: string): FullstackNode[] {
    const nodeMap = new Map(this.graph.nodes.map((n) => [n.id, n]));
    const startNode = nodeMap.get(componentId);
    if (!startNode || startNode.layer !== 'frontend') return [];

    const path: FullstackNode[] = [startNode];

    // Find backend nodes this component fetches
    const fetchEdges = this.graph.edges.filter(
      (e) => e.from === componentId && e.type === 'fetches',
    );

    for (const fetchEdge of fetchEdges) {
      const backendNode = nodeMap.get(fetchEdge.to);
      if (!backendNode) continue;

      path.push(backendNode);

      // Find database nodes this backend queries
      const queryEdges = this.graph.edges.filter(
        (e) => e.from === fetchEdge.to && e.type === 'queries',
      );

      for (const queryEdge of queryEdges) {
        const dbNode = nodeMap.get(queryEdge.to);
        if (dbNode) {
          path.push(dbNode);
        }
      }
    }

    return path;
  }

  getAffectedNodes(filePath: string): FullstackNode[] {
    // Find all nodes in the same connected subgraph as any node with this filePath
    const startNodes = this.graph.nodes.filter((n) => n.filePath === filePath);
    if (startNodes.length === 0) return [];

    const visited = new Set<string>();
    const queue: string[] = startNodes.map((n) => n.id);

    // BFS on undirected edges
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const edge of this.graph.edges) {
        if (edge.from === current && !visited.has(edge.to)) {
          queue.push(edge.to);
        }
        if (edge.to === current && !visited.has(edge.from)) {
          queue.push(edge.from);
        }
      }
    }

    const nodeMap = new Map(this.graph.nodes.map((n) => [n.id, n]));
    return [...visited]
      .map((id) => nodeMap.get(id))
      .filter((n): n is FullstackNode => n !== undefined);
  }
}
