import type { StackInfo, ProjectMap, RouteInfo, ComponentInfo, EndpointInfo } from '../models/types.js';

export interface IStackDetector {
  /**
   * Detects the tech stack of a project by examining config files.
   *
   * Check order:
   * 1. package.json → dependencies → next, vite, react-scripts, nuxt, svelte, astro
   * 2. *.csproj → .NET
   * 3. requirements.txt / pyproject.toml → python (django, fastapi, flask)
   * 4. go.mod → go
   * 5. Cargo.toml → rust
   * 6. docker-compose.yml → check services
   *
   * @returns StackInfo with framework, language, packageManager, typescript flag
   * @returns { framework: 'unknown', language: 'unknown', typescript: false } if can't detect
   */
  detectStack(projectPath: string): Promise<StackInfo>;

  /**
   * Determines the dev server command for the detected stack.
   *
   * Logic:
   * - Next.js/Vite/CRA: reads package.json scripts → "dev" or "start" → prefixes with package manager
   * - .NET: "dotnet run"
   * - Python: "python manage.py runserver" (django) or "uvicorn" (fastapi)
   *
   * @returns command string, or empty string if can't determine
   */
  detectDevCommand(stack: StackInfo, projectPath: string): Promise<string>;

  /**
   * Determines the dev server port.
   *
   * Logic:
   * - Reads from framework config files (next.config.js, vite.config.ts, launchSettings.json)
   * - Falls back to framework defaults: Next.js → 3000, Vite → 5173, .NET → 5000
   * - Falls back to 3000 if unknown
   */
  detectPort(stack: StackInfo, projectPath: string): Promise<number>;
}

export interface IRouteExtractor {
  /**
   * Extracts routes/pages from the project.
   *
   * Next.js: scans app/ directory, file-based routing (page.tsx → route)
   * Vite/CRA: parses react-router config (regex on <Route path=)
   * .NET: parses [Route] attributes and MapGet/MapPost
   *
   * @returns array of RouteInfo, empty if none found
   */
  extract(projectPath: string, stack: StackInfo): Promise<RouteInfo[]>;
}

export interface IComponentExtractor {
  /**
   * Extracts React/Vue/Svelte components from the project.
   *
   * Scans .tsx/.jsx/.vue/.svelte files.
   * Detects: component name (from export or filename), props, type (component/page/layout/hook).
   * Hooks: files starting with "use" and exporting a function.
   *
   * @returns array of ComponentInfo, empty if none found
   */
  extract(projectPath: string, stack: StackInfo): Promise<ComponentInfo[]>;
}

export interface IEndpointExtractor {
  /**
   * Extracts API endpoints from the project.
   *
   * Next.js: app/api/`**`/route.ts - method from exported function names (GET, POST, etc.)
   * Express: regex on app.get/post/put/delete
   * .NET: regex on [HttpGet], [HttpPost], MapGet(), MapPost()
   *
   * @returns array of EndpointInfo, empty if none found
   */
  extract(projectPath: string, stack: StackInfo): Promise<EndpointInfo[]>;
}

export interface IProjectIndexer {
  /**
   * Full project indexation. Calls all extractors, builds dependency graph,
   * generates compressed context. Saves to .nova/.
   *
   * @returns complete ProjectMap
   */
  index(projectPath: string): Promise<ProjectMap>;

  /**
   * Incrementally update index for changed files.
   * Re-parses only the changed files and their direct dependents.
   */
  update(changedFiles: string[]): Promise<void>;
}

export interface IContextDistiller {
  /**
   * Generates a compressed text description of the project for LLM context.
   * Target: ~2000 tokens.
   *
   * Format:
   * - Stack: Next.js + TypeScript
   * - Structure: {file count} files, {component count} components, {endpoint count} endpoints
   * - Key routes: /dashboard, /settings, /api/users, ...
   * - Key components: Layout, CustomerTable, Button, ...
   * - Key endpoints: GET /api/users, POST /api/auth/login, ...
   * - Data models: User, Transaction, Document, ...
   */
  distill(projectMap: ProjectMap): string;
}
