import type { SearchResult } from '../models/types.js';
import type { IGraphStore, ISearchRouter } from '../contracts/IStorage.js';

const GRAPH_SCORE_BOOST = 1.0;
const DEFAULT_LIMIT = 10;

export class SearchRouter implements ISearchRouter {
  constructor(private readonly graphStore: IGraphStore) {}

  async search(query: string, limit: number = DEFAULT_LIMIT): Promise<SearchResult[]> {
    const resultMap = new Map<string, SearchResult>();

    // Level 1: graph keyword search
    const graphNodes = await this.graphStore.search(query);
    for (let i = 0; i < graphNodes.length; i++) {
      const node = graphNodes[i];
      // Score: inverse rank position + boost for graph results
      const score = (graphNodes.length - i) / graphNodes.length + GRAPH_SCORE_BOOST;
      resultMap.set(node.filePath, {
        filePath: node.filePath,
        score,
        matchType: 'graph',
        snippet: node.exports.length > 0
          ? `exports: ${node.exports.join(', ')}`
          : undefined,
      });
    }

    // Level 1b: graph traversal — find importers/imports for top results
    const topFiles = graphNodes.slice(0, 5).map((n) => n.filePath);
    for (const filePath of topFiles) {
      const importers = await this.graphStore.getImporters(filePath);
      for (const imp of importers) {
        if (!resultMap.has(imp)) {
          resultMap.set(imp, {
            filePath: imp,
            score: 0.5,
            matchType: 'graph',
            snippet: `imports ${filePath}`,
          });
        }
      }
    }

    // Level 2 (semantic) would be added here when sqlite-vec is available

    const results = [...resultMap.values()];
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
