import { describe, it, expect, vi } from 'vitest';
import { ProjectMapApi } from '../ProjectMapApi.js';
import type { IGraphStore, ISearchRouter } from '@novastorm-ai/core';
import type { DependencyNode } from '@novastorm-ai/core';
import type http from 'node:http';

function makeRequest(url: string, method = 'GET'): http.IncomingMessage {
  return {
    url,
    method,
    headers: { host: 'localhost:3001' },
  } as unknown as http.IncomingMessage;
}

function makeResponse(): http.ServerResponse & { _status: number; _body: string } {
  const res: Record<string, unknown> = {
    _status: 0,
    _body: '',
    _headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) Object.assign(res._headers as Record<string, string>, headers);
    },
    setHeader(key: string, value: string) {
      (res._headers as Record<string, string>)[key] = value;
    },
    end(body?: string) {
      res._body = body ?? '';
    },
    headersSent: false,
  };
  return res as unknown as http.ServerResponse & { _status: number; _body: string };
}

function makeGraphStore(nodes: DependencyNode[]): IGraphStore {
  return {
    load: vi.fn(async () => nodes),
    save: vi.fn(),
    upsertNode: vi.fn(),
    removeNode: vi.fn(),
    getImporters: vi.fn(async () => []),
    getImports: vi.fn(async () => []),
    search: vi.fn(async () => []),
  };
}

describe('ProjectMapApi', () => {
  it('returns project map data on GET /nova-api/project-map', async () => {
    const api = new ProjectMapApi();
    const nodes: DependencyNode[] = [
      { filePath: 'src/a.ts', imports: ['src/b.ts'], exports: ['A'], type: 'component', keywords: ['a'] },
      { filePath: 'src/b.ts', imports: [], exports: ['B'], type: 'util', keywords: ['b'] },
    ];
    api.setGraphStore(makeGraphStore(nodes));

    const req = makeRequest('/nova-api/project-map');
    const res = makeResponse();
    const handled = await api.handleRequest(req, res);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);

    const data = JSON.parse(res._body);
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].source).toBe('src/a.ts');
    expect(data.edges[0].target).toBe('src/b.ts');
  });

  it('returns 503 when graph store not set', async () => {
    const api = new ProjectMapApi();
    const req = makeRequest('/nova-api/project-map');
    const res = makeResponse();
    const handled = await api.handleRequest(req, res);

    expect(handled).toBe(true);
    expect(res._status).toBe(503);
  });

  it('returns false for unknown routes', async () => {
    const api = new ProjectMapApi();
    const req = makeRequest('/unknown');
    const res = makeResponse();
    const handled = await api.handleRequest(req, res);

    expect(handled).toBe(false);
  });

  it('handles search requests', async () => {
    const api = new ProjectMapApi();
    const searchRouter: ISearchRouter = {
      search: vi.fn(async () => [
        { filePath: 'src/a.ts', score: 1.5, matchType: 'graph' as const },
      ]),
    };
    api.setSearchRouter(searchRouter);

    const req = makeRequest('/nova-api/project-map/search?q=test');
    const res = makeResponse();
    const handled = await api.handleRequest(req, res);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    const data = JSON.parse(res._body);
    expect(data.results).toHaveLength(1);
  });
});
