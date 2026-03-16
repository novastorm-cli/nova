import type { DependencyNode, SearchResult } from '../models/types.js';

export interface INovaDir {
  /**
   * Creates .nova/ directory structure:
   * .nova/config.toml, .nova/graph.json, .nova/context.md,
   * .nova/recipes/, .nova/history/, .nova/cache/
   *
   * Also adds ".nova" to .gitignore if not already present.
   * Idempotent — safe to call multiple times.
   */
  init(projectPath: string): Promise<void>;

  /** Returns true if .nova/ directory exists. */
  exists(projectPath: string): boolean;

  /** Removes .nova/ directory entirely. */
  clean(projectPath: string): Promise<void>;

  /** Returns absolute path to .nova/ for given project. */
  getPath(projectPath: string): string;
}

export interface IGraphStore {
  /**
   * Loads all dependency nodes from graph.json.
   * Returns empty array if file doesn't exist or is empty.
   */
  load(): Promise<DependencyNode[]>;

  /** Saves all nodes to graph.json (overwrites). */
  save(nodes: DependencyNode[]): Promise<void>;

  /**
   * Inserts or updates a single node (matched by filePath).
   * If node with same filePath exists — replaces it.
   */
  upsertNode(node: DependencyNode): Promise<void>;

  /** Removes node by filePath. No-op if not found. */
  removeNode(filePath: string): Promise<void>;

  /**
   * Returns file paths that import the given file.
   * Traverses the graph: finds all nodes whose `imports` array contains filePath.
   */
  getImporters(filePath: string): Promise<string[]>;

  /**
   * Returns what the given file imports (its `imports` array).
   * Returns empty array if file not in graph.
   */
  getImports(filePath: string): Promise<string[]>;

  /**
   * Keyword search across all nodes.
   * Matches against: filePath, keywords, exports, route.
   * Case-insensitive. Returns nodes sorted by relevance (most keyword matches first).
   */
  search(keyword: string): Promise<DependencyNode[]>;
}

export interface ISearchRouter {
  /**
   * Unified search across all available search levels.
   * Level 1 (always): graph traversal + keyword search
   * Level 2 (if available): semantic search via sqlite-vec
   *
   * Results are merged and deduplicated by filePath.
   * Graph results have higher priority (score boost).
   *
   * @param query - natural language query or keyword
   * @param limit - max results (default 10)
   */
  search(query: string, limit?: number): Promise<SearchResult[]>;
}
