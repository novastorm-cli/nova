import { readFile } from 'node:fs/promises';
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
import { ManifestStore } from '../storage/ManifestStore.js';
import type { Manifest } from '../models/manifest.js';
import { ContextDistiller } from './ContextDistiller.js';
import { FileWalker } from './FileWalker.js';
import { HashCache } from './HashCache.js';
import { LruCache } from './LruCache.js';
import type { ILogger } from '../contracts/ILogger.js';

const IMPORT_REGEX = /import.*from\s+['"](.+)['"]/g;
const REQUIRE_REGEX = /require\s*\(\s*['"](.+)['"]\s*\)/g;

const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const MODEL_REGEX = /export\s+(?:interface|type|class)\s+(\w+)/g;

const BATCH_SIZE = 50;

export class ProjectIndexer implements IProjectIndexer {
  private readonly stackDetector = new StackDetector();
  private readonly routeExtractor = new RouteExtractor();
  private readonly componentExtractor = new ComponentExtractor();
  private readonly endpointExtractor = new EndpointExtractor();
  private readonly novaDir = new NovaDir();
  private readonly distiller = new ContextDistiller();
  private readonly manifestStore = new ManifestStore();

  /** LRU cache for lazy file content loading (max 256 files) */
  readonly contentCache = new LruCache(256);

  private readonly logger: ILogger | null;
  private readonly fileWalker: FileWalker;

  private projectPath = '';
  private graphStore: GraphStore | null = null;
  private hashCache: HashCache | null = null;

  constructor(logger?: ILogger) {
    this.logger = logger ?? null;
    this.fileWalker = new FileWalker(this.logger ?? undefined);
  }

  async index(
    projectPath: string,
    config?: { frontend?: string; backends?: string[] },
  ): Promise<ProjectMap> {
    this.projectPath = projectPath;

    // Ensure .nova directory exists
    await this.novaDir.init(projectPath);
    const novaPath = this.novaDir.getPath(projectPath);
    this.graphStore = new GraphStore(novaPath);
    this.hashCache = new HashCache(novaPath);

    // Run all extractors in parallel (they do their own file scanning)
    const stack = await this.stackDetector.detectStack(projectPath);
    const [devCommand, port, routes, components, endpoints] = await Promise.all([
      this.stackDetector.detectDevCommand(stack, projectPath),
      this.stackDetector.detectPort(stack, projectPath),
      this.routeExtractor.extract(projectPath, stack),
      this.componentExtractor.extract(projectPath, stack),
      this.endpointExtractor.extract(projectPath, stack),
    ]);

    // Load manifest if available
    const manifest = await this.manifestStore.load(projectPath);

    // Build dependency graph and file contexts using the streaming walker
    const { files, cappedAt } = await this.collectScannableFiles(projectPath, config, manifest);

    this.logger?.debug('Indexer: discovered files', {
      fileCount: files.length,
      cappedAt: cappedAt ?? 0,
      component: 'ProjectIndexer',
    });

    // Compute the content hash from file metadata
    const currentHash = HashCache.computeHash(
      files.map((f) => ({
        relPath: f.relPath,
        mtimeMs: f.mtimeMs,
        size: f.size,
      })),
    );

    // Try warm start: if hash matches, skip content reads
    const cached = await this.hashCache.load();
    const hashMatch = cached !== null && cached.hash === currentHash;

    let dependencies: DependencyGraph;
    let fileContexts: Map<string, MiniContext>;
    let models: ModelInfo[] = [];

    if (hashMatch) {
      this.logger?.info('Indexer: hash cache hit -- skipping content reads', {
        fileCount: files.length,
        component: 'ProjectIndexer',
      });

      // Load dependency graph from disk (saved on previous run)
      const savedNodes = await this.graphStore.load();
      dependencies = new Map(savedNodes.map((n) => [n.filePath, n]));

      // Create lazy file contexts (content empty — filled on demand via LRU)
      fileContexts = new Map<string, MiniContext>();
      for (const { relPath } of files) {
        fileContexts.set(relPath, {
          filePath: relPath,
          content: '', // Content lazy-loaded via getFileContent()
          importedTypes: '', // Populated from graph if needed
        });
      }

      // Populate importedTypes from saved graph (no content reads needed)
      this.populateImportedTypesFromGraph(dependencies, fileContexts);
    } else {
      this.logger?.debug('Indexer: hash cache miss -- reading file contents', {
        fileCount: files.length,
        component: 'ProjectIndexer',
      });

      // Full content reads
      const result = await this.buildGraphAndContexts(files, routes, components, endpoints);

      dependencies = result.dependencies;
      fileContexts = result.fileContexts;
      models = result.models;

      // Save graph to disk
      await this.graphStore.save(Array.from(dependencies.values()));
    }

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
      frontend: config?.frontend,
      backends: config?.backends,
      manifest: manifest ?? undefined,
      ...(cappedAt !== undefined ? { cappedAt } : {}),
    };

    // Generate compressed context (may trigger LRU loads for content)
    projectMap.compressedContext = this.distiller.distill(projectMap);

    // Save hash cache for next warm start
    await this.hashCache.save({
      hash: currentHash,
      fileCount: files.length,
      timestamp: Date.now(),
    });

    return projectMap;
  }

  async update(changedFiles: string[]): Promise<void> {
    if (!this.graphStore || !this.projectPath) return;

    const existingNodes = await this.graphStore.load();
    const graph: DependencyGraph = new Map(existingNodes.map((n) => [n.filePath, n]));

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
        this.contentCache.set(relPath, '');
        continue;
      }

      // Cache the content in LRU
      this.contentCache.set(relPath, content);

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

    // Invalidate hash cache on update (contents changed)
    if (this.hashCache) {
      try {
        await this.hashCache.save({
          hash: 'invalidated-by-update',
          fileCount: 0,
          timestamp: 0,
        });
      } catch {
        // best effort
      }
    }
  }

  /**
   * Returns file content, using the LRU cache for lazy loading.
   * On cache miss, reads from disk and populates the cache.
   */
  async getFileContent(absPath: string, relPath: string): Promise<string | null> {
    const cached = this.contentCache.get(relPath);
    if (cached !== undefined) return cached || null;

    const content = await this.readFileSafe(absPath);
    if (content) {
      this.contentCache.set(relPath, content);
      return content;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // File collection (streaming, gitignore-aware)
  // ---------------------------------------------------------------------------

  private async collectScannableFiles(
    projectPath: string,
    config?: { frontend?: string; backends?: string[] },
    manifest?: Manifest | null,
  ): Promise<{
    files: Array<{ absPath: string; relPath: string; mtimeMs: number; size: number }>;
    cappedAt?: number | undefined;
  }> {
    // Manifest services take priority
    if (manifest?.services && manifest.services.length > 0) {
      const results: Array<{ absPath: string; relPath: string; mtimeMs: number; size: number }> =
        [];
      for (const service of manifest.services) {
        const walkResult = await this.fileWalker.walk(join(projectPath, service.path));
        results.push(...walkResult.files);
      }
      return { files: this.filterScannable(results), cappedAt: undefined };
    }

    // Config-specified directories
    if (config?.frontend || config?.backends) {
      const dirs: string[] = [];
      if (config.frontend) dirs.push(join(projectPath, config.frontend));
      for (const b of config.backends ?? []) dirs.push(join(projectPath, b));

      const results: Array<{ absPath: string; relPath: string; mtimeMs: number; size: number }> =
        [];
      for (const dir of dirs) {
        const walkResult = await this.fileWalker.walk(dir);
        results.push(...walkResult.files);
      }
      return { files: this.filterScannable(results), cappedAt: undefined };
    }

    // Default: walk entire project
    const walkResult = await this.fileWalker.walk(projectPath);
    let filtered = this.filterScannable(walkResult.files);

    // Apply manifest boundaries filtering
    if (manifest?.boundaries?.ignored && manifest.boundaries.ignored.length > 0) {
      const picomatch = (await import('picomatch')).default;
      const isIgnored = picomatch(manifest.boundaries.ignored);
      filtered = filtered.filter((f) => !isIgnored(f.relPath));
    }

    return { files: filtered, cappedAt: walkResult.cappedAt };
  }

  private filterScannable(
    files: Array<{ absPath: string; relPath: string; mtimeMs: number; size: number }>,
  ): Array<{ absPath: string; relPath: string; mtimeMs: number; size: number }> {
    return files.filter((f) => {
      const ext = extname(f.relPath);
      return SCANNABLE_EXTENSIONS.has(ext);
    });
  }

  // ---------------------------------------------------------------------------
  // Graph and context building (full content reads)
  // ---------------------------------------------------------------------------

  private async buildGraphAndContexts(
    files: Array<{ absPath: string; relPath: string; mtimeMs: number; size: number }>,
    routes: Array<{ path: string; filePath: string; type: string }>,
    components: Array<{ filePath: string; type: string }>,
    endpoints: Array<{ filePath: string }>,
  ): Promise<{
    dependencies: DependencyGraph;
    fileContexts: Map<string, MiniContext>;
    models: ModelInfo[];
  }> {
    const dependencies: DependencyGraph = new Map();
    const fileContexts = new Map<string, MiniContext>();
    const models: ModelInfo[] = [];

    // Read all files in batches to avoid fd exhaustion
    const fileContents = new Map<string, string>();
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async ({ absPath, relPath }) => {
          const content = await this.readFileSafe(absPath);
          if (content) {
            this.contentCache.set(relPath, content);
          }
          return [relPath, content] as const;
        }),
      );
      for (const [relPath, content] of results) {
        if (content) fileContents.set(relPath, content);
      }
    }

    for (const { relPath } of files) {
      const content = fileContents.get(relPath);
      if (!content) continue;

      // Extract imports
      const imports = this.extractImports(content);

      // Extract exports
      const exports = this.extractExports(content);

      // Classify file type
      const type = this.classifyFile(relPath, components, endpoints);

      // Detect keywords (top-level identifiers)
      const keywords = this.extractKeywords(content);

      // Find matching route
      const route = routes.find((r) => r.filePath === relPath)?.path;

      const node: DependencyNode = {
        filePath: relPath,
        imports,
        exports,
        type,
        ...(route && { route }),
        keywords,
      };

      dependencies.set(relPath, node);

      // Build MiniContext
      fileContexts.set(relPath, {
        filePath: relPath,
        content,
        importedTypes: '', // Populated in second pass
      });

      // Detect models
      this.extractModels(content, relPath, models);
    }

    // Second pass: populate importedTypes in fileContexts
    this.populateImportedTypes(dependencies, fileContexts);

    return { dependencies, fileContexts, models };
  }

  // ---------------------------------------------------------------------------
  // importedTypes population
  // ---------------------------------------------------------------------------

  private populateImportedTypes(
    dependencies: DependencyGraph,
    fileContexts: Map<string, MiniContext>,
  ): void {
    const TYPE_DEF_REGEX = /export\s+(?:interface|type)\s+\w+[^}]*}/g;
    const typeDefsCache = new Map<string, string[]>();

    for (const [filePath, ctx] of fileContexts) {
      if (!ctx.content) continue;
      const matches = ctx.content.match(TYPE_DEF_REGEX);
      if (matches) typeDefsCache.set(filePath, matches);
    }

    for (const [filePath, ctx] of fileContexts) {
      const node = dependencies.get(filePath);
      if (!node) continue;

      const importedTypes: string[] = [];
      for (const imp of node.imports) {
        const cached = typeDefsCache.get(imp);
        if (cached) {
          importedTypes.push(...cached);
        }
      }

      ctx.importedTypes = importedTypes.join('\n');
    }
  }

  /**
   * Populates importedTypes from the dependency graph alone (no content reads).
   * Used during warm start when file contents are skipped.
   */
  private populateImportedTypesFromGraph(
    dependencies: DependencyGraph,
    fileContexts: Map<string, MiniContext>,
  ): void {
    // On warm start, we skip content reads — importedTypes remain empty
    // Callers should use getFileContent() to lazily load content when needed
    for (const [filePath, ctx] of fileContexts) {
      const node = dependencies.get(filePath);
      if (!node) continue;
      ctx.importedTypes = '';
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
      const specifier = match[1]!;
      if (this.isRelativeImport(specifier)) {
        imports.push(this.normalizeImportPath(specifier));
      }
    }

    while ((match = REQUIRE_REGEX.exec(content)) !== null) {
      const specifier = match[1]!;
      if (this.isRelativeImport(specifier)) {
        imports.push(this.normalizeImportPath(specifier));
      }
    }

    return imports;
  }

  private extractExports(content: string): string[] {
    const exports: string[] = [];
    const regex =
      /export\s+(?:async\s+)?(?:function|const|class|let|var|enum|type|interface)\s+(\w+)/g;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (!exports.includes(match[1]!)) {
        exports.push(match[1]!);
      }
    }

    if (/export\s+default\b/.test(content)) {
      const defaultMatch = content.match(
        /export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/,
      );
      const name = defaultMatch ? defaultMatch[1]! : 'default';
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
      if (!keywords.includes(match[1]!)) {
        keywords.push(match[1]!);
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
      const name = match[1]!;
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
      const blockRegex = new RegExp(`(?:interface|type)\\s+${name}\\s*(?:=\\s*)?\\{([^}]*)\\}`);
      const blockMatch = content.match(blockRegex);
      const fields: string[] = [];

      if (blockMatch) {
        const fieldRegex = /(\w+)\s*[?:]?\s*:/g;
        let fMatch: RegExpExecArray | null;
        while ((fMatch = fieldRegex.exec(blockMatch[1]!)) !== null) {
          fields.push(fMatch[1]!);
        }
      }

      // Only add if it looks like a data model (has fields or is a class)
      if (fields.length > 0 || /export\s+class\s+/.test(content)) {
        models.push({
          name: name,
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
    const normalized = specifier.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '').replace(/\/index$/, '');

    // Keep the relative path as-is for now; the graph stores relative paths from project root
    return normalized;
  }

  private toPosix(p: string): string {
    return p.split('\\').join(posix.sep);
  }

  // ---------------------------------------------------------------------------
  // File system helpers
  // ---------------------------------------------------------------------------

  private async readFileSafe(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}
