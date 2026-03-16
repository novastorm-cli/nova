import { readFile, readdir } from 'node:fs/promises';
import { join, relative, posix, extname } from 'node:path';
import type { IProjectIndexer } from '../contracts/IIndexer.js';
import type {
  ProjectMap,
  DependencyGraph,
  DependencyNode,
  MiniContext,
  ModelInfo,
} from '../models/types.js';
import { StackDetector } from './StackDetector.js';
import { RouteExtractor } from './RouteExtractor.js';
import { ComponentExtractor } from './ComponentExtractor.js';
import { EndpointExtractor } from './EndpointExtractor.js';
import { NovaDir, GraphStore } from '../storage/index.js';
import { ContextDistiller } from './ContextDistiller.js';

const IMPORT_REGEX = /import.*from\s+['"](.+)['"]/g;
const REQUIRE_REGEX = /require\s*\(\s*['"](.+)['"]\s*\)/g;

const SCANNABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.next', '.nuxt', 'dist', 'build', '.git', '.nova',
]);

const MODEL_REGEX = /export\s+(?:interface|type|class)\s+(\w+)/g;
const MODEL_FIELD_REGEX = /(?:interface|type)\s+\w+\s*(?:=\s*)?{([^}]*)}/;

export class ProjectIndexer implements IProjectIndexer {
  private readonly stackDetector = new StackDetector();
  private readonly routeExtractor = new RouteExtractor();
  private readonly componentExtractor = new ComponentExtractor();
  private readonly endpointExtractor = new EndpointExtractor();
  private readonly novaDir = new NovaDir();
  private readonly distiller = new ContextDistiller();

  private projectPath = '';
  private graphStore: GraphStore | null = null;

  async index(projectPath: string): Promise<ProjectMap> {
    this.projectPath = projectPath;

    // Ensure .nova directory exists
    await this.novaDir.init(projectPath);
    const novaPath = this.novaDir.getPath(projectPath);
    this.graphStore = new GraphStore(novaPath);

    // Run all extractors in parallel
    const stack = await this.stackDetector.detectStack(projectPath);
    const [devCommand, port, routes, components, endpoints] = await Promise.all([
      this.stackDetector.detectDevCommand(stack, projectPath),
      this.stackDetector.detectPort(stack, projectPath),
      this.routeExtractor.extract(projectPath, stack),
      this.componentExtractor.extract(projectPath, stack),
      this.endpointExtractor.extract(projectPath, stack),
    ]);

    // Build dependency graph and file contexts
    const allFiles = await this.readDirRecursive(projectPath);
    const scannableFiles = allFiles.filter((f) => {
      const ext = extname(f);
      return SCANNABLE_EXTENSIONS.has(ext);
    });

    const dependencies: DependencyGraph = new Map();
    const fileContexts = new Map<string, MiniContext>();
    const models: ModelInfo[] = [];

    for (const absPath of scannableFiles) {
      const rel = this.toPosix(relative(projectPath, absPath));
      const content = await this.readFileSafe(absPath);
      if (!content) continue;

      // Extract imports
      const imports = this.extractImports(content);

      // Extract exports
      const exports = this.extractExports(content);

      // Classify file type
      const type = this.classifyFile(rel, components, endpoints);

      // Detect keywords (top-level identifiers)
      const keywords = this.extractKeywords(content);

      // Find matching route
      const route = routes.find((r) => r.filePath === rel)?.path;

      const node: DependencyNode = {
        filePath: rel,
        imports,
        exports,
        type,
        ...(route && { route }),
        keywords,
      };

      dependencies.set(rel, node);

      // Build MiniContext
      fileContexts.set(rel, {
        filePath: rel,
        content,
        importedTypes: '', // Populated in second pass
      });

      // Detect models (interfaces/types that look like data models)
      this.extractModels(content, rel, models);
    }

    // Second pass: populate importedTypes in fileContexts
    for (const [filePath, ctx] of fileContexts) {
      const node = dependencies.get(filePath);
      if (!node) continue;

      const importedTypes: string[] = [];
      for (const imp of node.imports) {
        const importedCtx = fileContexts.get(imp);
        if (!importedCtx) continue;

        // Extract type/interface definitions from imported file
        const typeMatches = importedCtx.content.match(
          /export\s+(?:interface|type)\s+\w+[^}]*}/g,
        );
        if (typeMatches) {
          importedTypes.push(...typeMatches);
        }
      }

      ctx.importedTypes = importedTypes.join('\n');
    }

    // Save graph to store
    const nodeArray = Array.from(dependencies.values());
    await this.graphStore.save(nodeArray);

    // Build project map
    const projectMap: ProjectMap = {
      stack,
      devCommand,
      port,
      routes,
      components,
      endpoints,
      models,
      dependencies,
      fileContexts,
      compressedContext: '',
    };

    // Generate compressed context
    projectMap.compressedContext = this.distiller.distill(projectMap);

    return projectMap;
  }

  async update(changedFiles: string[]): Promise<void> {
    if (!this.graphStore || !this.projectPath) return;

    const existingNodes = await this.graphStore.load();
    const graph: DependencyGraph = new Map(
      existingNodes.map((n) => [n.filePath, n]),
    );

    // Find direct dependents of changed files
    const filesToReindex = new Set<string>(
      changedFiles.map((f) => this.toPosix(relative(this.projectPath, f))),
    );

    for (const changedRel of [...filesToReindex]) {
      for (const [filePath, node] of graph) {
        if (node.imports.includes(changedRel)) {
          filesToReindex.add(filePath);
        }
      }
    }

    // Re-index each affected file
    for (const relPath of filesToReindex) {
      const absPath = join(this.projectPath, relPath);
      const content = await this.readFileSafe(absPath);

      if (!content) {
        // File was deleted
        await this.graphStore.removeNode(relPath);
        graph.delete(relPath);
        continue;
      }

      const imports = this.extractImports(content);
      const exports = this.extractExports(content);
      const keywords = this.extractKeywords(content);

      const existing = graph.get(relPath);

      const node: DependencyNode = {
        filePath: relPath,
        imports,
        exports,
        type: existing?.type ?? 'util',
        ...(existing?.route && { route: existing.route }),
        keywords,
      };

      await this.graphStore.upsertNode(node);
    }
  }

  // ---------------------------------------------------------------------------
  // Import / export extraction
  // ---------------------------------------------------------------------------

  private extractImports(content: string): string[] {
    const imports: string[] = [];

    // Reset regex lastIndex
    IMPORT_REGEX.lastIndex = 0;
    REQUIRE_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = IMPORT_REGEX.exec(content)) !== null) {
      const specifier = match[1];
      if (this.isRelativeImport(specifier)) {
        imports.push(this.normalizeImportPath(specifier));
      }
    }

    while ((match = REQUIRE_REGEX.exec(content)) !== null) {
      const specifier = match[1];
      if (this.isRelativeImport(specifier)) {
        imports.push(this.normalizeImportPath(specifier));
      }
    }

    return imports;
  }

  private extractExports(content: string): string[] {
    const exports: string[] = [];
    const regex = /export\s+(?:async\s+)?(?:function|const|class|let|var|enum|type|interface)\s+(\w+)/g;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (!exports.includes(match[1])) {
        exports.push(match[1]);
      }
    }

    if (/export\s+default\b/.test(content)) {
      const defaultMatch = content.match(
        /export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/,
      );
      const name = defaultMatch ? defaultMatch[1] : 'default';
      if (!exports.includes(name)) {
        exports.push(name);
      }
    }

    return exports;
  }

  private extractKeywords(content: string): string[] {
    const keywords: string[] = [];
    // Extract function names, class names, interface names
    const identRegex = /(?:function|class|interface|type|enum|const|let|var)\s+([A-Z]\w{2,})/g;

    let match: RegExpExecArray | null;
    while ((match = identRegex.exec(content)) !== null) {
      if (!keywords.includes(match[1])) {
        keywords.push(match[1]);
      }
    }

    return keywords;
  }

  // ---------------------------------------------------------------------------
  // Model extraction
  // ---------------------------------------------------------------------------

  private extractModels(content: string, relPath: string, models: ModelInfo[]): void {
    MODEL_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = MODEL_REGEX.exec(content)) !== null) {
      const name = match[1];
      // Skip common non-model patterns (Props, Context, Config, etc.)
      if (
        name.endsWith('Props') ||
        name.endsWith('Context') ||
        name.endsWith('Config') ||
        name.endsWith('Options') ||
        name.endsWith('State') ||
        name.endsWith('Action') ||
        name.endsWith('Reducer')
      ) {
        continue;
      }

      // Try to extract fields
      const blockRegex = new RegExp(
        `(?:interface|type)\\s+${name}\\s*(?:=\\s*)?\\{([^}]*)\\}`,
      );
      const blockMatch = content.match(blockRegex);
      const fields: string[] = [];

      if (blockMatch) {
        const fieldRegex = /(\w+)\s*[?:]?\s*:/g;
        let fMatch: RegExpExecArray | null;
        while ((fMatch = fieldRegex.exec(blockMatch[1])) !== null) {
          fields.push(fMatch[1]);
        }
      }

      // Only add if it looks like a data model (has fields or is a class)
      if (fields.length > 0 || /export\s+class\s+/.test(content)) {
        models.push({
          name,
          filePath: relPath,
          ...(fields.length > 0 && { fields }),
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Classification
  // ---------------------------------------------------------------------------

  private classifyFile(
    relPath: string,
    components: Array<{ filePath: string; type: string }>,
    endpoints: Array<{ filePath: string }>,
  ): DependencyNode['type'] {
    // Check if it matches a known component
    const comp = components.find((c) => c.filePath === relPath);
    if (comp) {
      if (comp.type === 'hook') return 'hook';
      if (comp.type === 'page') return 'page';
      return 'component';
    }

    // Check if it's an API endpoint
    if (endpoints.some((e) => e.filePath === relPath)) return 'api';

    // Heuristic classification
    if (relPath.includes('/model') || relPath.includes('/types') || relPath.includes('/schema')) {
      return 'model';
    }
    if (relPath.includes('/config') || relPath.includes('.config.')) {
      return 'config';
    }
    if (relPath.includes('/hook') || /\/use[A-Z]/.test(relPath)) {
      return 'hook';
    }
    if (relPath.includes('/util') || relPath.includes('/lib') || relPath.includes('/helper')) {
      return 'util';
    }

    return 'util';
  }

  // ---------------------------------------------------------------------------
  // Path helpers
  // ---------------------------------------------------------------------------

  private isRelativeImport(specifier: string): boolean {
    return specifier.startsWith('.') || specifier.startsWith('/');
  }

  private normalizeImportPath(specifier: string): string {
    // Remove file extension if present, then strip leading ./
    let normalized = specifier
      .replace(/\.(tsx?|jsx?|mjs|cjs)$/, '')
      .replace(/\/index$/, '');

    // Keep the relative path as-is for now; the graph stores relative paths from project root
    return normalized;
  }

  private toPosix(p: string): string {
    return p.split('\\').join(posix.sep);
  }

  // ---------------------------------------------------------------------------
  // File system helpers
  // ---------------------------------------------------------------------------

  private async readDirRecursive(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true, recursive: true });
      return entries
        .filter((e) => {
          if (!e.isFile()) return false;
          // Skip ignored directories
          const parent = (e as { parentPath?: string }).parentPath ?? (e as { path?: string }).path ?? dir;
          const rel = relative(dir, parent);
          const parts = rel.split(/[\\/]/);
          return !parts.some((p) => IGNORED_DIRS.has(p));
        })
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
