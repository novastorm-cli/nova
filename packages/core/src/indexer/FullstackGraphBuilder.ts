import { readFile } from 'node:fs/promises';
import type {
  ProjectMap,
  FullstackGraph,
  FullstackNode,
  FullstackEdge,
  EndpointInfo,
  ModelInfo,
  StackInfo,
} from '../models/types.js';

interface ApiCall {
  url: string;
  method: string;
}

interface OrmQuery {
  modelName: string;
  operation: string;
}

export class FullstackGraphBuilder {
  constructor(private readonly projectPath: string) {}

  async build(projectMap: ProjectMap): Promise<FullstackGraph> {
    const nodes: FullstackNode[] = [];
    const edges: FullstackEdge[] = [];

    // 1. Frontend nodes
    for (const comp of projectMap.components) {
      const nodeType =
        comp.type === 'page'
          ? ('page' as const)
          : comp.type === 'hook'
            ? ('hook' as const)
            : ('component' as const);
      nodes.push({
        id: `${comp.filePath}:${comp.name}`,
        name: comp.name,
        filePath: comp.filePath,
        type: nodeType,
        layer: 'frontend',
        metadata: {
          exports: comp.exports,
          ...(comp.props ? { props: comp.props } : {}),
        },
      });
    }

    // 2. Backend nodes
    for (const ep of projectMap.endpoints) {
      const name = ep.handler ?? `${ep.method} ${ep.path}`;
      nodes.push({
        id: `${ep.filePath}:${name}`,
        name,
        filePath: ep.filePath,
        type: 'api_endpoint',
        layer: 'backend',
        metadata: { method: ep.method, path: ep.path },
      });
    }

    // 3. Database nodes
    for (const model of projectMap.models) {
      nodes.push({
        id: `${model.filePath}:${model.name}`,
        name: model.name,
        filePath: model.filePath,
        type: 'db_model',
        layer: 'database',
        metadata: {
          ...(model.fields ? { fields: model.fields } : {}),
        },
      });
    }

    // 4. Frontend -> Backend edges (fetches)
    const componentFiles = new Set(projectMap.components.map((c) => c.filePath));
    for (const filePath of componentFiles) {
      const content = await this.safeReadFile(filePath);
      if (!content) continue;

      const apiCalls = this.extractApiCalls(content);
      for (const call of apiCalls) {
        const matched = this.matchUrlToEndpoint(call.url, projectMap.endpoints);
        if (!matched) continue;

        const fromNodes = nodes.filter((n) => n.filePath === filePath && n.layer === 'frontend');
        const toName = matched.handler ?? `${matched.method} ${matched.path}`;
        const toId = `${matched.filePath}:${toName}`;

        for (const fromNode of fromNodes) {
          if (!edges.some((e) => e.from === fromNode.id && e.to === toId && e.type === 'fetches')) {
            edges.push({
              from: fromNode.id,
              to: toId,
              type: 'fetches',
              metadata: { url: call.url, method: call.method },
            });
          }
        }
      }
    }

    // 5. Backend -> Database edges (queries)
    const endpointFiles = new Set(projectMap.endpoints.map((e) => e.filePath));
    for (const filePath of endpointFiles) {
      const content = await this.safeReadFile(filePath);
      if (!content) continue;

      const queries = this.extractOrmQueries(content, projectMap.stack);
      for (const query of queries) {
        const matched = this.matchModelNameToModel(query.modelName, projectMap.models);
        if (!matched) continue;

        const fromNodes = nodes.filter((n) => n.filePath === filePath && n.layer === 'backend');
        const toId = `${matched.filePath}:${matched.name}`;

        for (const fromNode of fromNodes) {
          if (!edges.some((e) => e.from === fromNode.id && e.to === toId && e.type === 'queries')) {
            edges.push({
              from: fromNode.id,
              to: toId,
              type: 'queries',
              metadata: { operation: query.operation },
            });
          }
        }
      }
    }

    // 6. Component -> Component edges (renders)
    for (const [filePath, depNode] of projectMap.dependencies) {
      const fromComps = nodes.filter((n) => n.filePath === filePath && n.layer === 'frontend');
      if (fromComps.length === 0) continue;

      for (const imp of depNode.imports) {
        const toComps = nodes.filter((n) => n.filePath === imp && n.layer === 'frontend');
        for (const fromNode of fromComps) {
          for (const toNode of toComps) {
            if (
              !edges.some(
                (e) => e.from === fromNode.id && e.to === toNode.id && e.type === 'renders',
              )
            ) {
              edges.push({
                from: fromNode.id,
                to: toNode.id,
                type: 'renders',
              });
            }
          }
        }
      }
    }

    return { nodes, edges };
  }

  extractApiCalls(content: string): ApiCall[] {
    const results: ApiCall[] = [];

    // fetch calls
    const fetchRe = /fetch\s*\(\s*[`'"](\/api\/[^`'"]+)[`'"]/g;
    let m: RegExpExecArray | null;
    while ((m = fetchRe.exec(content)) !== null) {
      results.push({ url: m[1]!, method: 'GET' });
    }

    // fetch with full URL containing /api/
    const fetchFullRe = /fetch\s*\(\s*[`'"]([^`'"]*\/api\/[^`'"]+)[`'"]/g;
    while ((m = fetchFullRe.exec(content)) !== null) {
      const url = m[1]!;
      // Skip if already captured by the first regex
      if (url.startsWith('/api/')) continue;
      results.push({ url, method: 'GET' });
    }

    // axios calls
    const axiosMethodRe =
      /axios\s*\.\s*(get|post|put|patch|delete)\s*\(\s*[`'"](\/api\/[^`'"]+)[`'"]/g;
    while ((m = axiosMethodRe.exec(content)) !== null) {
      results.push({ url: m[2]!, method: m[1]!.toUpperCase() });
    }

    // axios config style
    const axiosConfigRe = /axios\s*\(\s*\{[^}]*url\s*:\s*[`'"](\/api\/[^`'"]+)[`'"]/g;
    while ((m = axiosConfigRe.exec(content)) !== null) {
      results.push({ url: m[1]!, method: 'GET' });
    }

    // SWR
    const swrRe = /useSWR\s*\(\s*[`'"](\/api\/[^`'"]+)[`'"]/g;
    while ((m = swrRe.exec(content)) !== null) {
      results.push({ url: m[1]!, method: 'GET' });
    }

    // React Query
    const rqRe = /useQuery\s*\([^)]*[`'"](\/api\/[^`'"]+)[`'"]/g;
    while ((m = rqRe.exec(content)) !== null) {
      results.push({ url: m[1]!, method: 'GET' });
    }

    return results;
  }

  extractOrmQueries(content: string, stack: StackInfo): OrmQuery[] {
    const results: OrmQuery[] = [];
    let m: RegExpExecArray | null;

    // Prisma
    const prismaRe =
      /prisma\.(\w+)\.\s*(findMany|findUnique|findFirst|create|update|delete|upsert|count|aggregate)/g;
    while ((m = prismaRe.exec(content)) !== null) {
      results.push({ modelName: m[1]!, operation: m[2]! });
    }

    // Django ORM
    const djangoRe =
      /(\w+)\.objects\.\s*(filter|get|create|all|exclude|aggregate|annotate|update|delete)/g;
    while ((m = djangoRe.exec(content)) !== null) {
      results.push({ modelName: m[1]!, operation: m[2]! });
    }

    // SQLAlchemy - session.query(Model)
    const sqlaQueryRe = /session\.query\(\s*(\w+)\s*\)/g;
    while ((m = sqlaQueryRe.exec(content)) !== null) {
      results.push({ modelName: m[1]!, operation: 'query' });
    }

    // SQLAlchemy - db.session.add/delete/query
    const sqlaSessionRe = /db\.session\.\s*(add|delete|query)\s*\(\s*(\w+)/g;
    while ((m = sqlaSessionRe.exec(content)) !== null) {
      results.push({ modelName: m[2]!, operation: m[1]! });
    }

    // Entity Framework
    const efContextRe = /_context\.(\w+)\./g;
    while ((m = efContextRe.exec(content)) !== null) {
      results.push({ modelName: m[1]!, operation: 'query' });
    }

    // Entity Framework DbSet<Model>
    const efDbSetRe = /DbSet<(\w+)>/g;
    while ((m = efDbSetRe.exec(content)) !== null) {
      results.push({ modelName: m[1]!, operation: 'dbset' });
    }

    // TypeORM - getRepository(Model)
    const typeormRepoRe = /getRepository\(\s*(\w+)\s*\)/g;
    while ((m = typeormRepoRe.exec(content)) !== null) {
      results.push({ modelName: m[1]!, operation: 'repository' });
    }

    return results;
  }

  matchUrlToEndpoint(url: string, endpoints: EndpointInfo[]): EndpointInfo | null {
    // Normalize URL: strip query string, trailing slash
    const normalizedUrl = url.split('?')[0]!.replace(/\/$/, '');

    // Exact match first
    const exact = endpoints.find((ep) => ep.path === normalizedUrl);
    if (exact) return exact;

    // Path-param match: /api/users/:id matches /api/users/123
    for (const ep of endpoints) {
      const epParts = ep.path.split('/');
      const urlParts = normalizedUrl.split('/');

      if (epParts.length !== urlParts.length) continue;

      let match = true;
      for (let i = 0; i < epParts.length; i++) {
        if (epParts[i]!.startsWith(':') || epParts[i]!.startsWith('[')) continue;
        if (epParts[i]! !== urlParts[i]!) {
          match = false;
          break;
        }
      }
      if (match) return ep;
    }

    // Prefix match: /api/users/123 could match /api/users when no param route exists
    const sorted = [...endpoints].sort((a, b) => b.path.length - a.path.length);
    for (const ep of sorted) {
      if (normalizedUrl.startsWith(ep.path + '/') || normalizedUrl === ep.path) {
        return ep;
      }
    }

    return null;
  }

  matchModelNameToModel(name: string, models: ModelInfo[]): ModelInfo | null {
    const lower = name.toLowerCase();

    // Exact match
    const exact = models.find((m) => m.name.toLowerCase() === lower);
    if (exact) return exact;

    // Plural/singular heuristic: "users" -> "User", "Users" -> "User"
    const singularized = lower.endsWith('s') ? lower.slice(0, -1) : lower;
    const singular = models.find((m) => m.name.toLowerCase() === singularized);
    if (singular) return singular;

    // Pluralized: "user" -> "Users"
    const pluralized = lower + 's';
    const plural = models.find((m) => m.name.toLowerCase() === pluralized);
    if (plural) return plural;

    return null;
  }

  private async safeReadFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}
