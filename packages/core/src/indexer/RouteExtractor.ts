import { readFile, readdir } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';
import type { IRouteExtractor } from '../contracts/IIndexer.js';
import type { RouteInfo, StackInfo } from '../models/types.js';

export class RouteExtractor implements IRouteExtractor {
  async extract(projectPath: string, stack: StackInfo): Promise<RouteInfo[]> {
    const routes: RouteInfo[] = [];

    if (stack.framework === 'next.js') {
      await this.extractNextAppRoutes(projectPath, routes);
      await this.extractNextPagesRoutes(projectPath, routes);
    }

    if (stack.framework === 'vite' || stack.framework === 'cra') {
      await this.extractReactRouterRoutes(projectPath, routes);
    }

    if (stack.framework === 'dotnet') {
      await this.extractDotnetRoutes(projectPath, routes);
    }

    return routes;
  }

  // ---------------------------------------------------------------------------
  // Next.js App Router
  // ---------------------------------------------------------------------------

  private async extractNextAppRoutes(
    projectPath: string,
    routes: RouteInfo[],
  ): Promise<void> {
    const appDir = join(projectPath, 'app');
    const srcAppDir = join(projectPath, 'src', 'app');

    for (const dir of [appDir, srcAppDir]) {
      const files = await this.readDirRecursive(dir);
      if (files.length === 0) continue;

      for (const filePath of files) {
        const rel = relative(dir, filePath);
        const parts = rel.split(/[\\/]/);
        const fileName = parts[parts.length - 1];

        if (this.isPageFile(fileName)) {
          const routePath = this.filePathToRoute(parts.slice(0, -1));
          const relFromProject = relative(projectPath, filePath);

          // Check if this is under an api/ segment
          if (parts.includes('api')) {
            continue; // API routes handled separately via route.ts
          }

          routes.push({
            path: routePath,
            filePath: this.toPosix(relFromProject),
            type: 'page',
          });
        }

        if (this.isLayoutFile(fileName)) {
          const routePath = this.filePathToRoute(parts.slice(0, -1));
          const relFromProject = relative(projectPath, filePath);

          routes.push({
            path: routePath,
            filePath: this.toPosix(relFromProject),
            type: 'layout',
          });
        }

        if (this.isRouteHandler(fileName)) {
          const routePath = this.filePathToRoute(parts.slice(0, -1));
          const relFromProject = relative(projectPath, filePath);
          const methods = await this.detectRouteHandlerMethods(filePath);

          routes.push({
            path: routePath,
            filePath: this.toPosix(relFromProject),
            type: 'api',
            methods,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Next.js Pages Router
  // ---------------------------------------------------------------------------

  private async extractNextPagesRoutes(
    projectPath: string,
    routes: RouteInfo[],
  ): Promise<void> {
    const pagesDir = join(projectPath, 'pages');
    const srcPagesDir = join(projectPath, 'src', 'pages');

    for (const dir of [pagesDir, srcPagesDir]) {
      const files = await this.readDirRecursive(dir);
      if (files.length === 0) continue;

      for (const filePath of files) {
        const rel = relative(dir, filePath);
        const parts = rel.split(/[\\/]/);
        const fileName = parts[parts.length - 1];

        if (!this.isComponentFile(fileName)) continue;
        // Skip _app, _document, _error special files
        if (fileName.startsWith('_')) continue;

        const relFromProject = relative(projectPath, filePath);
        const isApi = parts[0] === 'api';

        if (isApi) {
          const methods = await this.detectPagesApiMethods(filePath);
          const routePath = this.pagesFileToRoute(parts);

          routes.push({
            path: routePath,
            filePath: this.toPosix(relFromProject),
            type: 'api',
            methods,
          });
        } else {
          const routePath = this.pagesFileToRoute(parts);

          routes.push({
            path: routePath,
            filePath: this.toPosix(relFromProject),
            type: 'page',
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // React Router (Vite / CRA)
  // ---------------------------------------------------------------------------

  private async extractReactRouterRoutes(
    projectPath: string,
    routes: RouteInfo[],
  ): Promise<void> {
    const srcDir = join(projectPath, 'src');
    const files = await this.readDirRecursive(srcDir);
    if (files.length === 0) return;

    for (const filePath of files) {
      if (!this.isComponentFile(filePath)) continue;

      const content = await this.readFileSafe(filePath);
      if (!content) continue;

      // Match <Route path="/something" or <Route path={"/something"}
      const routeRegex = /<Route\s[^>]*path\s*=\s*["'{]?\s*["']([^"']+)["']/g;
      let match;
      while ((match = routeRegex.exec(content)) !== null) {
        const routePath = match[1];
        const relFromProject = relative(projectPath, filePath);

        routes.push({
          path: routePath,
          filePath: this.toPosix(relFromProject),
          type: routePath.startsWith('/api') ? 'api' : 'page',
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // .NET
  // ---------------------------------------------------------------------------

  private async extractDotnetRoutes(
    projectPath: string,
    routes: RouteInfo[],
  ): Promise<void> {
    const files = await this.readDirRecursive(projectPath);

    for (const filePath of files) {
      if (!filePath.endsWith('.cs')) continue;

      const content = await this.readFileSafe(filePath);
      if (!content) continue;

      const relFromProject = relative(projectPath, filePath);

      // [Route("api/[controller]")] style
      const routeAttrRegex = /\[Route\("([^"]+)"\)\]/g;
      let match;
      while ((match = routeAttrRegex.exec(content)) !== null) {
        const routePath = match[1].startsWith('/') ? match[1] : `/${match[1]}`;

        routes.push({
          path: routePath,
          filePath: this.toPosix(relFromProject),
          type: 'api',
        });
      }

      // MapGet("/path"), MapPost("/path") etc.
      const mapRegex = /Map(Get|Post|Put|Delete|Patch)\("([^"]+)"\)/g;
      while ((match = mapRegex.exec(content)) !== null) {
        const routePath = match[2].startsWith('/') ? match[2] : `/${match[2]}`;

        routes.push({
          path: routePath,
          filePath: this.toPosix(relFromProject),
          type: 'api',
          methods: [match[1].toUpperCase()],
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async detectRouteHandlerMethods(filePath: string): Promise<string[]> {
    const content = await this.readFileSafe(filePath);
    if (!content) return [];

    const methods: string[] = [];
    const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

    for (const method of httpMethods) {
      // Match: export async function GET, export function GET, export const GET
      const regex = new RegExp(
        `export\\s+(?:async\\s+)?(?:function|const)\\s+${method}\\b`,
      );
      if (regex.test(content)) {
        methods.push(method);
      }
    }

    return methods;
  }

  private async detectPagesApiMethods(filePath: string): Promise<string[]> {
    const content = await this.readFileSafe(filePath);
    if (!content) return [];

    // Pages API routes use req.method checks
    const methods: string[] = [];
    const methodRegex = /req\.method\s*===?\s*['"](\w+)['"]/g;
    let match;
    while ((match = methodRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      if (!methods.includes(method)) {
        methods.push(method);
      }
    }

    // If no explicit method checks, it handles all methods via default export
    if (methods.length === 0) {
      return ['GET', 'POST'];
    }

    return methods;
  }

  private filePathToRoute(segments: string[]): string {
    if (segments.length === 0) return '/';

    const routeParts = segments
      .filter((s) => !s.startsWith('(') || !s.endsWith(')')) // keep route groups for filtering
      .filter((s) => !(s.startsWith('(') && s.endsWith(')'))) // remove route groups
      .map((s) => {
        // [slug] → :slug, [[...slug]] → *slug, [...slug] → *slug
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

    const path = '/' + routeParts.join('/');
    return path === '/' ? '/' : path;
  }

  private pagesFileToRoute(parts: string[]): string {
    const withoutExt = [...parts];
    const last = withoutExt[withoutExt.length - 1];
    withoutExt[withoutExt.length - 1] = last.replace(/\.(tsx?|jsx?)$/, '');

    // index → remove (root of directory)
    if (withoutExt[withoutExt.length - 1] === 'index') {
      withoutExt.pop();
    }

    return this.filePathToRoute(withoutExt);
  }

  private isPageFile(fileName: string): boolean {
    return /^page\.(tsx?|jsx?)$/.test(fileName);
  }

  private isLayoutFile(fileName: string): boolean {
    return /^layout\.(tsx?|jsx?)$/.test(fileName);
  }

  private isRouteHandler(fileName: string): boolean {
    return /^route\.(tsx?|jsx?)$/.test(fileName);
  }

  private isComponentFile(fileName: string): boolean {
    return /\.(tsx?|jsx?)$/.test(fileName);
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
          // In Node 20+ with recursive, parentPath/path gives the directory
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
