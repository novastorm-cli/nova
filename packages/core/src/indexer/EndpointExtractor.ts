import { readFile, readdir } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';
import type { IEndpointExtractor } from '../contracts/IIndexer.js';
import type { EndpointInfo, StackInfo } from '../models/types.js';

const IGNORED_DIRS = new Set(['node_modules', '.next', '.nuxt', 'dist', 'build', '.git', '.nova']);

export class EndpointExtractor implements IEndpointExtractor {
  async extract(projectPath: string, stack: StackInfo): Promise<EndpointInfo[]> {
    const endpoints: EndpointInfo[] = [];

    if (stack.framework === 'next.js') {
      await this.extractNextjsEndpoints(projectPath, endpoints);
    }

    if (stack.framework === 'dotnet') {
      await this.extractDotnetEndpoints(projectPath, endpoints);
    }

    // Express detection: check for express in any JS/TS project
    if (
      stack.language === 'typescript' ||
      stack.language === 'javascript'
    ) {
      await this.extractExpressEndpoints(projectPath, endpoints);
    }

    return endpoints;
  }

  // ---------------------------------------------------------------------------
  // Next.js App Router API routes
  // ---------------------------------------------------------------------------

  private async extractNextjsEndpoints(
    projectPath: string,
    endpoints: EndpointInfo[],
  ): Promise<void> {
    const appDir = join(projectPath, 'app');
    const srcAppDir = join(projectPath, 'src', 'app');

    for (const dir of [appDir, srcAppDir]) {
      const files = await this.readDirRecursive(dir);

      for (const filePath of files) {
        const rel = relative(dir, filePath);
        const parts = rel.split(/[\\/]/);
        const fileName = parts[parts.length - 1];

        // Only route.ts/route.js files under api/ segments
        if (!/^route\.(tsx?|jsx?)$/.test(fileName)) continue;
        if (!parts.includes('api')) continue;

        const content = await this.readFileSafe(filePath);
        if (!content) continue;

        const routePath = this.segmentsToApiPath(parts.slice(0, -1));
        const relFromProject = relative(projectPath, filePath);
        const methods = this.detectExportedHttpMethods(content);

        for (const method of methods) {
          endpoints.push({
            method,
            path: routePath,
            filePath: this.toPosix(relFromProject),
            handler: method,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // .NET
  // ---------------------------------------------------------------------------

  private async extractDotnetEndpoints(
    projectPath: string,
    endpoints: EndpointInfo[],
  ): Promise<void> {
    const files = await this.readDirRecursive(projectPath);

    for (const filePath of files) {
      if (!filePath.endsWith('.cs')) continue;

      const content = await this.readFileSafe(filePath);
      if (!content) continue;

      const relFromProject = relative(projectPath, filePath);

      // Controller-based: [HttpGet("path")], [HttpPost], etc.
      this.extractControllerEndpoints(content, relFromProject, endpoints);

      // Minimal API: MapGet("/path", handler), MapPost("/path", handler)
      this.extractMinimalApiEndpoints(content, relFromProject, endpoints);
    }
  }

  private extractControllerEndpoints(
    content: string,
    relPath: string,
    endpoints: EndpointInfo[],
  ): void {
    // Detect [Route("basePath")] at controller level
    const routeBaseMatch = content.match(/\[Route\("([^"]+)"\)\]\s*(?:\[.*?\]\s*)*(?:public\s+)?class\s+(\w+)/);
    let basePath = '';
    if (routeBaseMatch) {
      let route = routeBaseMatch[1];
      const className = routeBaseMatch[2];
      // Resolve [controller] template to the controller name (class name minus "Controller" suffix)
      const controllerName = className.replace(/Controller$/i, '').toLowerCase();
      route = route.replace(/\[controller\]/gi, controllerName);
      basePath = route.startsWith('/') ? route : `/${route}`;
    }

    // Match [HttpGet], [HttpGet("subpath")], [HttpPost], etc.
    const httpAttrRegex = /\[Http(Get|Post|Put|Delete|Patch)(?:\("([^"]*)"\))?\]\s*(?:\[.*?\]\s*)*(?:public\s+)?(?:\w+(?:<[^>]+>)?\s+)?(\w+)/g;
    let match;
    while ((match = httpAttrRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const subPath = match[2] ?? '';
      const handler = match[3];

      let path = basePath;
      if (subPath) {
        path = basePath + (subPath.startsWith('/') ? subPath : `/${subPath}`);
      }
      if (!path) path = '/';

      endpoints.push({
        method,
        path,
        filePath: this.toPosix(relPath),
        handler,
      });
    }
  }

  private extractMinimalApiEndpoints(
    content: string,
    relPath: string,
    endpoints: EndpointInfo[],
  ): void {
    // app.MapGet("/path", ...) or builder.MapPost("/path", ...)
    const mapRegex = /\.Map(Get|Post|Put|Delete|Patch)\(\s*"([^"]+)"/g;
    let match;
    while ((match = mapRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2].startsWith('/') ? match[2] : `/${match[2]}`;

      endpoints.push({
        method,
        path,
        filePath: this.toPosix(relPath),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Express
  // ---------------------------------------------------------------------------

  private async extractExpressEndpoints(
    projectPath: string,
    endpoints: EndpointInfo[],
  ): Promise<void> {
    const files = await this.readDirRecursive(projectPath);

    for (const filePath of files) {
      if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(filePath)) continue;

      const rel = relative(projectPath, filePath);
      if (this.isIgnored(rel)) continue;

      const content = await this.readFileSafe(filePath);
      if (!content) continue;

      // Only scan files that likely use express
      if (
        !content.includes('express') &&
        !content.includes('.get(') &&
        !content.includes('.post(') &&
        !content.includes('router.')
      ) {
        continue;
      }

      const relFromProject = relative(projectPath, filePath);

      // Match app.get("/path" or router.post("/path" etc.
      const expressRegex = /(?:app|router|server)\.(get|post|put|delete|patch|options|head)\(\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = expressRegex.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        const path = match[2];

        endpoints.push({
          method,
          path,
          filePath: this.toPosix(relFromProject),
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private detectExportedHttpMethods(content: string): string[] {
    const methods: string[] = [];
    const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

    for (const method of httpMethods) {
      const regex = new RegExp(
        `export\\s+(?:async\\s+)?(?:function|const)\\s+${method}\\b`,
      );
      if (regex.test(content)) {
        methods.push(method);
      }
    }

    return methods;
  }

  private segmentsToApiPath(segments: string[]): string {
    if (segments.length === 0) return '/';

    const parts = segments
      .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
      .map((s) => {
        if (s.startsWith('[[') && s.endsWith(']]')) {
          return `:${s.slice(5, -2)}*`;
        }
        if (s.startsWith('[...') && s.endsWith(']')) {
          return `:${s.slice(4, -1)}*`;
        }
        if (s.startsWith('[') && s.endsWith(']')) {
          return `:${s.slice(1, -1)}`;
        }
        return s;
      });

    return '/' + parts.join('/');
  }

  private isIgnored(relPath: string): boolean {
    const parts = relPath.split(/[\\/]/);
    return parts.some((p) => IGNORED_DIRS.has(p));
  }

  private toPosix(p: string): string {
    return p.split('\\').join(posix.sep);
  }

  private async readDirRecursive(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true, recursive: true });
      return entries
        .filter((e) => e.isFile())
        .map((e) => {
          const parent = (e as { parentPath?: string }).parentPath ?? (e as { path?: string }).path ?? dir;
          return join(parent, e.name);
        });
    } catch {
      return [];
    }
  }

  private async readFileSafe(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}
