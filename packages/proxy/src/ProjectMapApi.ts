import type http from 'node:http';
import { URL } from 'node:url';
import type { IGraphStore, ISearchRouter } from '@novastorm-ai/core';
import type { ProjectAnalysis, DependencyNode } from '@novastorm-ai/core';

export interface ProjectMapNode {
  id: string;
  label: string;
  type: DependencyNode['type'];
  exports: string[];
  keywords: string[];
  route?: string;
  methods?: Array<{ name: string; signature: string; purpose: string }>;
}

export interface ProjectMapEdge {
  source: string;
  target: string;
}

export interface ProjectMapData {
  nodes: ProjectMapNode[];
  edges: ProjectMapEdge[];
  analysis: ProjectAnalysis | null;
  activeFiles: string[];
}

export class ProjectMapApi {
  private graphStore: IGraphStore | null = null;
  private searchRouter: ISearchRouter | null = null;
  private analysis: ProjectAnalysis | null = null;
  private activeFiles: string[] = [];

  setGraphStore(store: IGraphStore): void {
    this.graphStore = store;
  }

  setSearchRouter(router: ISearchRouter): void {
    this.searchRouter = router;
  }

  setAnalysis(analysis: ProjectAnalysis): void {
    this.analysis = analysis;
  }

  setActiveFiles(files: string[]): void {
    this.activeFiles = files;
  }

  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname === '/nova-api/project-map' && req.method === 'GET') {
      await this.handleGetMap(res);
      return true;
    }

    if (url.pathname === '/nova-api/project-map/search' && req.method === 'GET') {
      const query = url.searchParams.get('q') ?? '';
      await this.handleSearch(res, query);
      return true;
    }

    return false;
  }

  private async handleGetMap(res: http.ServerResponse): Promise<void> {
    if (!this.graphStore) {
      this.sendJson(res, 503, { error: 'Graph store not initialized' });
      return;
    }

    const nodes = await this.graphStore.load();
    const mapNodes: ProjectMapNode[] = nodes.map((n) => {
      const methods = this.analysis?.methods
        .filter((m) => m.filePath === n.filePath)
        .map((m) => ({ name: m.name, signature: m.signature, purpose: m.purpose })) ?? [];

      return {
        id: n.filePath,
        label: n.filePath.split('/').pop() ?? n.filePath,
        type: n.type,
        exports: n.exports,
        keywords: n.keywords,
        route: n.route,
        methods,
      };
    });

    const mapEdges: ProjectMapEdge[] = [];
    for (const node of nodes) {
      for (const imp of node.imports) {
        if (nodes.some((n) => n.filePath === imp)) {
          mapEdges.push({ source: node.filePath, target: imp });
        }
      }
    }

    const data: ProjectMapData = {
      nodes: mapNodes,
      edges: mapEdges,
      analysis: this.analysis,
      activeFiles: this.activeFiles,
    };

    this.sendJson(res, 200, data);
  }

  private async handleSearch(res: http.ServerResponse, query: string): Promise<void> {
    if (!query) {
      this.sendJson(res, 400, { error: 'Missing query parameter "q"' });
      return;
    }

    if (!this.searchRouter) {
      this.sendJson(res, 503, { error: 'Search router not initialized' });
      return;
    }

    const results = await this.searchRouter.search(query, 20);
    this.sendJson(res, 200, { results });
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  }
}
