import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { DependencyNode } from '../models/types.js';
import type { IGraphStore } from '../contracts/IStorage.js';

const GRAPH_FILE = 'graph.json';

export class GraphStore implements IGraphStore {
  private readonly graphPath: string;

  constructor(novaPath: string) {
    this.graphPath = join(novaPath, GRAPH_FILE);
  }

  async load(): Promise<DependencyNode[]> {
    try {
      const raw = await readFile(this.graphPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed as DependencyNode[];
    } catch {
      return [];
    }
  }

  async save(nodes: DependencyNode[]): Promise<void> {
    await mkdir(dirname(this.graphPath), { recursive: true });
    await writeFile(this.graphPath, JSON.stringify(nodes, null, 2), 'utf-8');
  }

  async upsertNode(node: DependencyNode): Promise<void> {
    const nodes = await this.load();
    const idx = nodes.findIndex((n) => n.filePath === node.filePath);
    if (idx >= 0) {
      nodes[idx] = node;
    } else {
      nodes.push(node);
    }
    await this.save(nodes);
  }

  async removeNode(filePath: string): Promise<void> {
    const nodes = await this.load();
    const filtered = nodes.filter((n) => n.filePath !== filePath);
    if (filtered.length !== nodes.length) {
      await this.save(filtered);
    }
  }

  async getImporters(filePath: string): Promise<string[]> {
    const nodes = await this.load();
    return nodes
      .filter((n) => n.imports.includes(filePath))
      .map((n) => n.filePath);
  }

  async getImports(filePath: string): Promise<string[]> {
    const nodes = await this.load();
    const node = nodes.find((n) => n.filePath === filePath);
    return node?.imports ?? [];
  }

  async search(keyword: string): Promise<DependencyNode[]> {
    const nodes = await this.load();
    const kw = keyword.toLowerCase();

    const scored: Array<{ node: DependencyNode; score: number }> = [];

    for (const node of nodes) {
      let score = 0;

      if (node.filePath.toLowerCase().includes(kw)) score++;

      for (const k of node.keywords) {
        if (k.toLowerCase().includes(kw)) score++;
      }

      for (const exp of node.exports) {
        if (exp.toLowerCase().includes(kw)) score++;
      }

      if (node.route?.toLowerCase().includes(kw)) score++;

      if (score > 0) {
        scored.push({ node, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.node);
  }
}
