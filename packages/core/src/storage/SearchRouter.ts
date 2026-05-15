import type { SearchResult } from '../models/types.js';
import type { IGraphStore, ISearchRouter, IVectorStore, IEmbeddingService } from '../contracts/IStorage.js';

const GRAPH_SCORE_BOOST = 1.0;
const SEMANTIC_SCORE_BOOST = 0.8;
const DEFAULT_LIMIT = 10;

export class SearchRouter implements ISearchRouter {
  private vectorStore: IVectorStore | null = null;
  private embeddingService: IEmbeddingService | null = null;

  constructor(private readonly graphStore: IGraphStore) {}

  setSemanticSearch(vectorStore: IVectorStore, embeddingService: IEmbeddingService): void {
    this.vectorStore = vectorStore;
    this.embeddingService = embeddingService;
  }

  async search(query: string, limit: number = DEFAULT_LIMIT): Promise<SearchResult[]> {
    const resultMap = new Map<string, SearchResult>();

    // Level 1: graph keyword search
    const graphNodes = await this.graphStore.search(query);
    for (let i = 0; i < graphNodes.length; i++) {
      const node = graphNodes[i]!;
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

    // Level 1b: graph traversal -- find importers/imports for top results
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

    // Level 2: semantic search via embeddings
    if (this.vectorStore && this.embeddingService) {
      try {
        const queryEmbedding = await this.embeddingService.embedSingle(query);
        const semanticResults = this.vectorStore.search(queryEmbedding, limit);

        for (const { record, score } of semanticResults) {
          const adjustedScore = score * SEMANTIC_SCORE_BOOST;
          const existing = resultMap.get(record.filePath);
          if (existing) {
            // Boost existing result
            existing.score += adjustedScore;
            if (!existing.snippet && record.chunkText) {
              existing.snippet = record.chunkText.slice(0, 200);
            }
          } else {
            resultMap.set(record.filePath, {
              filePath: record.filePath,
              score: adjustedScore,
              matchType: 'semantic',
              snippet: record.chunkText.slice(0, 200),
            });
          }
        }
      } catch {
        // Semantic search failed -- fall back to graph-only results
      }
    }

    const results = [...resultMap.values()];
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
