# Nova Architect — План мультиагентной разработки

## Принцип

**Contracts-first, tests-parallel.**

1. Сначала пишутся **контракты** — интерфейсы с сигнатурами методов и JSDoc-описанием поведения
2. Затем параллельно запускаются **два агента на каждый модуль**:
   - **impl-агент** — реализует контракт
   - **test-агент** — пишет тесты по контракту (не зная реализации)
3. Когда оба готовы — тесты запускаются против реализации

Тесты пишутся по контракту, не по реализации. Это значит:
- Тест-агент видит только интерфейс + JSDoc (описание поведения)
- Impl-агент видит только интерфейс + JSDoc (что реализовать)
- Ни один не зависит от другого — полный параллелизм

```
Phase 0: Scaffold + Contracts (all interfaces, method signatures, JSDoc)
            │
Phase 1:    ├── Module 1 impl ──┐
            ├── Module 1 test ──┤── run tests
            ├── Module 2 impl ──┐
            ├── Module 2 test ──┤── run tests
            ├── ...             │
            └── Module N test ──┤── run tests
            │
Phase 2:    ├── Integration impl + test (same pattern)
            │
Phase 3:    └── E2E tests
```

---

## Phase 0 — Scaffold + Контракты (последовательно, 1 поток)

Создаёт всё, от чего зависят все остальные задачи: монорепо, типы, контракты каждого модуля.

### Task 0.1 — Monorepo scaffold

```
Что делает:
- pnpm workspace + turborepo
- tsconfig.base.json с path aliases
- packages/cli, packages/core, packages/proxy, packages/overlay, packages/licensing
- Каждый пакет: package.json, tsconfig.json, src/index.ts
- vitest config (global + per-package)
- .gitignore, .editorconfig, .nvmrc (Node 22)
- bin/nova.ts → shebang entry point
- tests/ директория для E2E
- tests/fixtures/ для тестовых проектов

Выход: `pnpm build` и `pnpm test` проходят на пустых пакетах.
```

### Task 0.2 — Shared types (`packages/core/src/models/`)

```
Создаёт ВСЕ типы и интерфейсы проекта. Это единственный source of truth.

Файлы:
- packages/core/src/models/types.ts      — domain types
- packages/core/src/models/config.ts     — NovaConfig types
- packages/core/src/models/events.ts     — NovaEvent types
- packages/core/src/models/index.ts      — реэкспорт всего

Содержимое types.ts:
```

```typescript
// ============================================================
// Stack & Indexer
// ============================================================

export interface StackInfo {
  framework: string;        // "next.js", "vite", "dotnet", "django", etc.
  language: string;         // "typescript", "javascript", "csharp", "python"
  packageManager?: string;  // "npm", "yarn", "pnpm", "bun"
  typescript: boolean;
}

export interface RouteInfo {
  path: string;             // "/dashboard", "/api/users"
  filePath: string;         // "app/dashboard/page.tsx"
  type: 'page' | 'api' | 'layout';
  methods?: string[];       // for API: ["GET", "POST"]
}

export interface ComponentInfo {
  name: string;             // "CustomerTable"
  filePath: string;         // "components/CustomerTable.tsx"
  type: 'component' | 'page' | 'layout' | 'hook';
  exports: string[];        // exported symbol names
  props?: string[];         // prop names if detectable
}

export interface EndpointInfo {
  method: string;           // "GET", "POST", etc.
  path: string;             // "/api/users"
  filePath: string;
  handler?: string;         // function/method name
}

export interface ModelInfo {
  name: string;             // "User", "Transaction"
  filePath: string;
  fields?: string[];
}

export interface DependencyNode {
  filePath: string;
  imports: string[];
  exports: string[];
  type: 'component' | 'page' | 'api' | 'model' | 'hook' | 'util' | 'config';
  route?: string;
  keywords: string[];
}

export type DependencyGraph = Map<string, DependencyNode>;

export interface MiniContext {
  filePath: string;
  content: string;
  importedTypes: string;    // concatenated type definitions from imports
}

export interface ProjectMap {
  stack: StackInfo;
  devCommand: string;
  port: number;
  routes: RouteInfo[];
  components: ComponentInfo[];
  endpoints: EndpointInfo[];
  models: ModelInfo[];
  dependencies: DependencyGraph;
  fileContexts: Map<string, MiniContext>;
  compressedContext: string;
}

// ============================================================
// Observation (overlay → proxy → core)
// ============================================================

export interface Observation {
  screenshot: Buffer;
  clickCoords?: { x: number; y: number };
  domSnapshot?: string;
  transcript?: string;
  currentUrl: string;
  consoleErrors?: string[];
  timestamp: number;
}

// ============================================================
// Tasks
// ============================================================

export type TaskType = 'css' | 'single_file' | 'multi_file' | 'refactor';
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'rolled_back';
export type Lane = 1 | 2 | 3 | 4;

export interface TaskItem {
  id: string;
  description: string;
  files: string[];
  type: TaskType;
  lane: Lane;
  status: TaskStatus;
  commitHash?: string;
  diff?: string;
  error?: string;
}

export interface ExecutionResult {
  success: boolean;
  taskId: string;
  diff?: string;
  commitHash?: string;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ file: string; line?: number; message: string }>;
}

// ============================================================
// LLM
// ============================================================

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
}

export interface LlmClient {
  chat(messages: Message[], options?: LlmOptions): Promise<string>;
  chatWithVision(messages: Message[], images: Buffer[], options?: LlmOptions): Promise<string>;
  stream(messages: Message[], options?: LlmOptions): AsyncIterable<string>;
}

// ============================================================
// Git
// ============================================================

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: Date;
  files: string[];
}

// ============================================================
// License
// ============================================================

export type LicenseTier = 'free' | 'company' | 'enterprise';

export interface LicenseStatus {
  valid: boolean;
  tier: LicenseTier;
  devCount: number;
  message?: string;
}

// ============================================================
// Search
// ============================================================

export interface SearchResult {
  filePath: string;
  score: number;
  matchType: 'graph' | 'keyword' | 'semantic';
  snippet?: string;
}
```

```
Содержимое config.ts:
```

```typescript
export interface NovaConfig {
  project: {
    devCommand: string;
    port: number;
  };
  models: {
    fast: string;
    strong: string;
    local: boolean;
  };
  apiKeys: {
    provider: 'openrouter' | 'anthropic' | 'openai' | 'ollama';
    key?: string;  // resolved from env or .nova/config.toml
  };
  behavior: {
    autoCommit: boolean;
    branchPrefix: string;
    passiveSuggestions: boolean;
  };
  voice: {
    enabled: boolean;
    engine: 'web' | 'whisper';
  };
}

export const DEFAULT_CONFIG: NovaConfig = {
  project: { devCommand: '', port: 3000 },
  models: { fast: 'openrouter/qwen-2.5-coder-7b', strong: 'anthropic/claude-sonnet-4', local: false },
  apiKeys: { provider: 'openrouter' },
  behavior: { autoCommit: false, branchPrefix: 'nova/', passiveSuggestions: true },
  voice: { enabled: true, engine: 'web' },
};
```

```
Содержимое events.ts:
```

```typescript
import type { Observation, TaskItem } from './types.js';

export type NovaEvent =
  | { type: 'observation'; data: Observation }
  | { type: 'task_created'; data: TaskItem }
  | { type: 'task_started'; data: { taskId: string } }
  | { type: 'task_completed'; data: { taskId: string; diff: string; commitHash: string } }
  | { type: 'task_failed'; data: { taskId: string; error: string } }
  | { type: 'file_changed'; data: { filePath: string; source: 'user' | 'nova' } }
  | { type: 'index_updated'; data: { filesChanged: string[] } }
  | { type: 'status'; data: { message: string } };

export type NovaEventType = NovaEvent['type'];

export interface EventBus {
  emit(event: NovaEvent): void;
  on<T extends NovaEventType>(type: T, handler: (event: Extract<NovaEvent, { type: T }>) => void): void;
  off<T extends NovaEventType>(type: T, handler: (event: Extract<NovaEvent, { type: T }>) => void): void;
}
```

### Task 0.3 — Контракты всех модулей

Создаёт файл контракта для каждого модуля. Контракт — это **interface/abstract class + JSDoc**, описывающий:
- Что каждый метод делает
- Какие аргументы принимает
- Что возвращает
- Какие edge cases обрабатывает
- Какие ошибки бросает

Impl-агент реализует контракт. Test-агент пишет тесты по JSDoc.

```
Файлы (каждый — отдельный контракт):
```

**`packages/core/src/contracts/IConfigReader.ts`**
```typescript
import type { NovaConfig } from '../models/config.js';

export interface IConfigReader {
  /**
   * Reads and merges configuration from all sources.
   *
   * Priority (highest wins):
   * 1. Environment variables: NOVA_API_KEY, NOVA_LICENSE_KEY
   * 2. Local config: .nova/config.toml (API keys, local prefs)
   * 3. Project config: nova.toml (committed to repo)
   * 4. Default values from DEFAULT_CONFIG
   *
   * @param projectPath - absolute path to project root
   * @returns merged NovaConfig
   * @throws {ConfigError} if nova.toml has invalid TOML syntax (message includes line number)
   * @throws {ConfigError} if required field has invalid value (e.g. port < 0)
   *
   * Behavior:
   * - If nova.toml doesn't exist → uses defaults for all project fields
   * - If .nova/config.toml doesn't exist → skips local overrides
   * - Missing optional fields → filled from DEFAULT_CONFIG
   * - NOVA_API_KEY env overrides apiKeys.key from any config file
   */
  read(projectPath: string): Promise<NovaConfig>;

  /**
   * Writes a nova.toml file with the given config.
   * Only writes fields that differ from DEFAULT_CONFIG.
   *
   * @param projectPath - absolute path to project root
   * @param config - config to write
   */
  write(projectPath: string, config: Partial<NovaConfig>): Promise<void>;

  /**
   * Checks if nova.toml exists in the given directory.
   */
  exists(projectPath: string): Promise<boolean>;
}

export class ConfigError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
```

**`packages/core/src/contracts/ILlmClient.ts`**
```typescript
import type { LlmClient, LlmOptions, Message } from '../models/types.js';

/**
 * Factory that creates an LlmClient for the given provider.
 *
 * Supported providers: 'anthropic', 'openrouter', 'openai', 'ollama'
 *
 * @throws {ProviderError} if provider is unknown
 * @throws {ProviderError} if apiKey is missing for non-ollama providers
 */
export interface IProviderFactory {
  create(provider: string, apiKey?: string): LlmClient;
}

/**
 * Each provider implements LlmClient:
 *
 * chat():
 * - Sends messages to the model, returns full response text
 * - Throws ProviderError on HTTP 401 (invalid key), 429 (rate limit), 5xx (server error)
 * - Retries once on 429 with exponential backoff (1s)
 * - Respects options.model to override default model
 * - Respects options.maxTokens (default: 4096)
 * - Respects options.temperature (default: 0)
 * - When options.responseFormat is 'json', instructs model to respond with valid JSON
 *
 * chatWithVision():
 * - Same as chat(), but includes images as base64-encoded parts in the user message
 * - images are Buffer[] of PNG data
 * - Throws ProviderError if the model doesn't support vision
 *
 * stream():
 * - Returns an AsyncIterable that yields text chunks as they arrive
 * - Throws ProviderError on same conditions as chat()
 * - Consumer can break out of the loop to cancel the stream
 */

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly provider?: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
```

**`packages/core/src/contracts/IGitManager.ts`**
```typescript
import type { CommitInfo } from '../models/types.js';

export interface IGitManager {
  /**
   * Creates a new branch from current HEAD.
   * Branch name format: `{prefix}{timestamp}` e.g. "nova/1710583200"
   * Checks out the new branch.
   *
   * @returns the created branch name
   * @throws {GitError} if not a git repository
   * @throws {GitError} if there are uncommitted changes (call stash() first)
   */
  createBranch(prefix: string): Promise<string>;

  /**
   * Stages the given files and creates a commit.
   *
   * @param message - commit message
   * @param files - relative file paths to stage. If empty, stages all changes.
   * @returns the commit hash (short, 7 chars)
   * @throws {GitError} if no changes to commit
   */
  commit(message: string, files: string[]): Promise<string>;

  /**
   * Reverts a commit by hash (git revert --no-edit).
   * Creates a new revert commit.
   *
   * @throws {GitError} if hash doesn't exist
   * @throws {GitError} if revert has conflicts
   */
  rollback(commitHash: string): Promise<void>;

  /**
   * Returns the diff for a specific commit.
   * @returns unified diff string
   */
  getDiff(commitHash: string): Promise<string>;

  /**
   * Returns commit log for a branch (or current branch if not specified).
   * Ordered newest first. Limited to last 50 commits.
   */
  getLog(branch?: string): Promise<CommitInfo[]>;

  /** Returns current branch name. */
  getCurrentBranch(): Promise<string>;

  /**
   * Counts unique commit authors (by email) in the repo history.
   * Used for license checking.
   */
  getDevCount(): Promise<number>;

  /** Returns true if there are uncommitted changes in the working tree. */
  hasUncommittedChanges(): Promise<boolean>;

  /** Stash current changes. */
  stash(): Promise<void>;

  /** Pop stashed changes. @throws {GitError} if stash is empty. */
  unstash(): Promise<void>;
}

export class GitError extends Error {
  constructor(message: string, public readonly command?: string) {
    super(message);
    this.name = 'GitError';
  }
}
```

**`packages/core/src/contracts/IStorage.ts`**
```typescript
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
```

**`packages/core/src/contracts/IIndexer.ts`**
```typescript
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
   * Next.js: app/api/**/route.ts → method from exported function names (GET, POST, etc.)
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
```

**`packages/core/src/contracts/IBrain.ts`**
```typescript
import type { Observation, ProjectMap, TaskItem, Message } from '../models/types.js';

export interface IBrain {
  /**
   * Analyzes an observation (screenshot + voice + click) and produces actionable tasks.
   *
   * Process:
   * 1. Matches currentUrl to known route → loads relevant file contexts
   * 2. Builds multimodal prompt (screenshot + transcript + project context)
   * 3. Sends to LLM via chatWithVision
   * 4. Parses JSON response into TaskItem[]
   * 5. Classifies each task → assigns lane
   *
   * @returns array of TaskItems with lanes assigned
   * @throws {BrainError} if LLM returns unparseable response after 2 retries
   */
  analyze(observation: Observation, projectMap: ProjectMap): Promise<TaskItem[]>;
}

export interface ITaskDecomposer {
  /**
   * Breaks a complex task (Lane 3+) into smaller subtasks (Lane 1-2 each).
   *
   * Sends task description + project context to LLM.
   * Each subtask gets its own file list and lane assignment.
   *
   * @returns array of subtasks. If task is already simple → returns [task] unchanged.
   */
  decompose(task: TaskItem, projectMap: ProjectMap): Promise<TaskItem[]>;
}

export interface IPromptBuilder {
  /**
   * Builds the analysis prompt for the Brain.
   * Includes: system instructions, screenshot placeholder, transcript, DOM snapshot, project context.
   * Screenshot is NOT included in messages — it's passed separately to chatWithVision.
   */
  buildAnalysisPrompt(observation: Observation, projectMap: ProjectMap): Message[];

  /**
   * Builds the decomposition prompt for TaskDecomposer.
   * Includes: task description, affected files, project context.
   */
  buildDecomposePrompt(task: TaskItem, projectMap: ProjectMap): Message[];
}

export interface ILaneClassifier {
  /**
   * Classifies a task into a speed lane (1-4) based on description and affected files.
   * Pure rule-based, no LLM. Must complete in < 1ms.
   *
   * Rules (checked in order):
   * 1. Style/text-only keywords + single element → Lane 1
   *    Keywords: color, font, margin, padding, display, visibility, text, label,
   *    placeholder, opacity, border, width, height, gap, radius, background, align
   * 2. Single file affected → Lane 2
   * 3. Multiple files OR keywords: add.*page, new.*endpoint, create.*component → Lane 3
   * 4. Keywords: refactor, migrate, rewrite, redesign, restructure, upgrade → Lane 4
   * 5. Default → Lane 2
   *
   * Special case: "add blue button" is Lane 2 (new element), not Lane 1 (not just style change)
   */
  classify(taskDescription: string, affectedFiles: string[]): 1 | 2 | 3 | 4;
}

export class BrainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrainError';
  }
}
```

**`packages/core/src/contracts/IExecutor.ts`**
```typescript
import type { TaskItem, ProjectMap, ExecutionResult, ValidationResult } from '../models/types.js';

export interface IExecutorPool {
  /**
   * Executes a task by routing it to the correct lane executor.
   *
   * Lane 1 → Lane1Executor (AST/regex, no LLM)
   * Lane 2 → Lane2Executor (single API call, fast model)
   * Lane 3 → decomposes via TaskDecomposer, then executes subtasks
   * Lane 4 → spawns background process
   *
   * Emits events via EventBus: task_started, task_completed, task_failed
   *
   * @returns ExecutionResult with diff and commit hash on success
   */
  execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult>;
}

export interface ILane1Executor {
  /**
   * Instant execution for CSS/text/visibility changes. No LLM.
   *
   * Process:
   * 1. Parse domSnapshot → extract CSS class / element identifier
   * 2. Find matching class/selector in source files (regex search)
   * 3. Apply regex/AST replacement (e.g. color: red → color: blue)
   * 4. Write file
   *
   * Falls back to Ollama (local model) if regex approach can't handle it.
   *
   * @returns ExecutionResult. diff contains the change made.
   * @throws if can't map DOM element to source file
   */
  execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult>;
}

export interface ILane2Executor {
  /**
   * Fast single-file execution via LLM.
   *
   * Process:
   * 1. Load pre-built mini-context for the target file
   * 2. Send to fast model: "modify this file to {task}. Respond with ONLY a unified diff."
   * 3. Parse unified diff from response
   * 4. Apply diff to file via DiffApplier
   * 5. Commit via GitManager
   *
   * @returns ExecutionResult with diff and commitHash
   */
  execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult>;
}

export interface IDiffApplier {
  /**
   * Applies a unified diff to a file.
   *
   * Parses the diff format:
   * - @@ -start,count +start,count @@
   * - Lines starting with - are removed
   * - Lines starting with + are added
   * - Context lines (space prefix) must match file content
   *
   * @throws {DiffError} if context lines don't match (file was modified since diff was generated)
   * @throws {DiffError} if diff format is invalid
   * @throws {DiffError} if file doesn't exist
   */
  apply(filePath: string, diff: string): Promise<void>;

  /**
   * Generates a unified diff between two strings.
   * Used for creating diffs from before/after content.
   */
  generate(before: string, after: string, filePath: string): string;
}

export interface IValidator {
  /**
   * Validates changed files by running project's type checker and linter.
   *
   * Checks (in order, skips if tool not present):
   * 1. TypeScript: tsc --noEmit (if tsconfig.json exists)
   * 2. ESLint: eslint {files} (if .eslintrc* exists)
   * 3. Build: runs build command from package.json (if exists, timeout 30s)
   *
   * @returns ValidationResult. valid=true if all checks pass.
   */
  validate(projectPath: string, changedFiles: string[]): Promise<ValidationResult>;
}

export class DiffError extends Error {
  constructor(message: string, public readonly filePath?: string) {
    super(message);
    this.name = 'DiffError';
  }
}
```

**`packages/core/src/contracts/IProxy.ts`**
```typescript
import type { Observation } from '../models/types.js';
import type { NovaEvent } from '../models/events.js';

export interface IProxyServer {
  /**
   * Starts HTTP proxy server.
   *
   * - Proxies all HTTP requests from proxyPort to targetPort
   * - For HTML responses: injects <script src="/nova-overlay.js"></script> before </body>
   * - Serves /nova-overlay.js from the given overlayScriptPath
   * - Strips Content-Security-Policy headers (for dev mode)
   * - Does NOT modify non-HTML responses (JSON, CSS, JS, images)
   *
   * @param targetPort - the dev server port (e.g. 3000)
   * @param proxyPort - the port to listen on (e.g. 3001)
   * @param overlayScriptPath - absolute path to nova-overlay.js bundle
   *
   * @throws if proxyPort is already in use
   */
  start(targetPort: number, proxyPort: number, overlayScriptPath: string): Promise<void>;

  /** Stops the proxy server. */
  stop(): Promise<void>;

  /** Returns true if proxy is running. */
  isRunning(): boolean;
}

export interface IWebSocketServer {
  /**
   * Starts WebSocket server on the given HTTP server.
   * Endpoint: ws://localhost:{port}/nova-ws
   *
   * Receives Observation objects from overlay.
   * Sends NovaEvent objects to overlay.
   */
  start(httpServer: any): void;

  /** Register handler for incoming observations. */
  onObservation(handler: (observation: Observation) => void): void;

  /** Send event to all connected overlay clients. */
  sendEvent(event: NovaEvent): void;

  /** Returns number of connected clients. */
  getClientCount(): number;
}

export interface IDevServerRunner {
  /**
   * Spawns the dev server as a child process.
   *
   * - Captures stdout/stderr
   * - Health-checks by polling http://localhost:{port} every 500ms
   * - Calls onReady when first successful response (max wait: 30s)
   * - Calls onError if process exits unexpectedly
   *
   * @param command - shell command to run (e.g. "npm run dev")
   * @param cwd - working directory
   * @param port - expected port, used for health check
   */
  spawn(command: string, cwd: string, port: number): Promise<void>;

  /** Register callback for when server is ready (health check passes). */
  onReady(handler: () => void): void;

  /** Register callback for when server crashes or exits. */
  onError(handler: (error: string) => void): void;

  /** Returns captured stdout + stderr as string. */
  getLogs(): string;

  /** Gracefully kills the dev server process (SIGTERM, then SIGKILL after 5s). */
  kill(): Promise<void>;

  /** Returns true if process is running. */
  isRunning(): boolean;
}
```

**`packages/core/src/contracts/ILicense.ts`**
```typescript
import type { LicenseStatus, NovaConfig } from '../models/index.js';

export interface ILicenseChecker {
  /**
   * Checks if the current project requires a paid license.
   *
   * Logic:
   * 1. Count unique commit authors (by email) via `git log --format='%ae' | sort -u`
   * 2. If devCount <= 3 → { valid: true, tier: 'free' }
   * 3. If devCount > 3 AND NOVA_LICENSE_KEY (env or config) exists → validate key format + checksum
   * 4. If devCount > 3 AND no key → { valid: false, tier: 'company', message: "Company license required..." }
   *
   * License key format: "NOVA-{base32}-{checksum}" where checksum = first 4 chars of sha256(body)
   *
   * @returns LicenseStatus
   * Does NOT throw — always returns a status.
   * If git is not available → assumes devCount = 1 → free.
   */
  check(projectPath: string, config: NovaConfig): Promise<LicenseStatus>;
}

export interface ITelemetry {
  /**
   * Sends anonymous telemetry ping. Fire-and-forget — never throws, never blocks.
   *
   * Payload: { licenseKey: string | null, devCount: number, projectHash: string, version: string }
   * projectHash = sha256(projectPath), NOT project content
   * Endpoint: POST https://api.nova-architect.dev/telemetry
   *
   * Disabled when: NOVA_TELEMETRY=false env var is set
   * Timeout: 3 seconds, then silently abandons
   */
  send(licenseKey: string | null, devCount: number, projectPath: string): Promise<void>;
}
```

**`packages/overlay/src/contracts/ICapture.ts`**
```typescript
export interface IScreenshotCapture {
  /**
   * Captures the current viewport as PNG blob.
   * Uses html2canvas. Resizes to max 1920x1080 if viewport is larger.
   *
   * @returns PNG blob
   * @throws if html2canvas fails (e.g. cross-origin iframes)
   */
  captureViewport(): Promise<Blob>;
}

export interface IDomCapture {
  /**
   * Captures HTML snippet of an element and its context.
   *
   * Includes: the element + 2 levels of parent elements.
   * Strips noisy attributes: data-reactid, data-testid, class names > 100 chars.
   * Adds inline computed styles for: color, background, font-size, display, position.
   *
   * @returns cleaned HTML string, max ~2000 chars
   */
  captureElement(element: HTMLElement): string;
}

export interface IVoiceCapture {
  /**
   * Starts continuous voice recognition using Web Speech API.
   * Emits interim and final transcription results via callback.
   *
   * Supports: Russian (ru-RU) and English (en-US).
   * Auto-detects language if browser supports it.
   *
   * Does nothing if Web Speech API is not available (no error).
   */
  start(): void;

  /** Stops voice recognition. */
  stop(): void;

  /** Returns true if currently listening. */
  isListening(): boolean;

  /**
   * Register callback for transcription results.
   * @param handler - receives { text: string, isFinal: boolean }
   */
  onTranscript(handler: (result: { text: string; isFinal: boolean }) => void): void;
}

export interface IConsoleCapture {
  /**
   * Installs console.error and console.warn interceptors.
   * Stores last 20 errors. Does NOT suppress original console output.
   * Idempotent — safe to call multiple times.
   */
  install(): void;

  /** Removes interceptors, restores original console methods. */
  uninstall(): void;

  /** Returns captured errors (newest first). */
  getErrors(): string[];

  /** Register callback for new errors. */
  onError(handler: (error: string) => void): void;
}
```

**`packages/overlay/src/contracts/IOverlayUI.ts`**
```typescript
export interface IOverlayPill {
  /**
   * Renders the floating pill in bottom-right corner.
   * Uses shadow DOM for style isolation from host app.
   *
   * States: idle (gray), listening (green pulse), processing (blue spin), error (red)
   * Draggable — remembers position in localStorage.
   * Click → calls onActivate callback.
   */
  mount(container: HTMLElement): void;
  unmount(): void;
  setState(state: 'idle' | 'listening' | 'processing' | 'error'): void;
  onActivate(handler: () => void): void;
}

export interface ICommandInput {
  /**
   * Text input panel for typing commands.
   * Shows below/above the pill depending on screen position.
   *
   * Enter → submit (calls onSubmit), Escape → close (calls onClose).
   * Arrow Up/Down → cycle through command history (stored in localStorage, max 50).
   * Can display interim voice transcription text.
   */
  show(anchorElement: HTMLElement): void;
  hide(): void;
  isVisible(): boolean;
  setTranscript(text: string): void;
  onSubmit(handler: (text: string) => void): void;
  onClose(handler: () => void): void;
}

export interface IElementSelector {
  /**
   * Enables element selection mode.
   * Hover → highlights element with outline (2px solid blue).
   * Click → selects element, calls onSelect with the element.
   * Escape → cancels mode, calls onCancel.
   *
   * Must NOT interfere with normal page interaction when not active.
   * Must prevent default click behavior when active (stopPropagation + preventDefault).
   */
  activate(): void;
  deactivate(): void;
  isActive(): boolean;
  onSelect(handler: (element: HTMLElement) => void): void;
  onCancel(handler: () => void): void;
}

export interface IStatusToast {
  /**
   * Shows a toast notification.
   *
   * Types: 'info' (blue), 'success' (green), 'error' (red)
   * Position: top-right, stacks vertically.
   * Auto-dismiss after 5s (configurable). Errors don't auto-dismiss.
   * Click on toast → calls onClick handler with toast id.
   * Max 5 visible toasts. Oldest dismissed when limit exceeded.
   */
  show(message: string, type: 'info' | 'success' | 'error', durationMs?: number): string;  // returns toast id
  dismiss(id: string): void;
  dismissAll(): void;
  onClick(handler: (id: string) => void): void;
}
```

```
Итого файлы контрактов:
- packages/core/src/contracts/IConfigReader.ts
- packages/core/src/contracts/ILlmClient.ts
- packages/core/src/contracts/IGitManager.ts
- packages/core/src/contracts/IStorage.ts
- packages/core/src/contracts/IIndexer.ts
- packages/core/src/contracts/IBrain.ts
- packages/core/src/contracts/IExecutor.ts
- packages/core/src/contracts/IProxy.ts
- packages/core/src/contracts/ILicense.ts
- packages/overlay/src/contracts/ICapture.ts
- packages/overlay/src/contracts/IOverlayUI.ts
- packages/core/src/contracts/index.ts (реэкспорт всего)
- packages/overlay/src/contracts/index.ts (реэкспорт всего)

Выход: все контракты компилируются, экспортируются.
```

### Task 0.4 — EventBus реализация + тест-фикстуры

```
Что делает:
- packages/core/src/events/EventBus.ts — реализация на EventEmitter (typed)
- tests/fixtures/ — минимальные проекты для тестов:
  - tests/fixtures/nextjs-app/ (package.json с next, app/page.tsx, app/api/users/route.ts)
  - tests/fixtures/vite-app/ (package.json с vite, src/App.tsx, src/components/Button.tsx)
  - tests/fixtures/dotnet-app/ (*.csproj, Controllers/UsersController.cs)
  - tests/fixtures/empty-project/ (пустая директория)

Выход: EventBus работает. Фикстуры на месте.
```

---

## Phase 1 — Реализация + Тесты (параллельно, до 24 потоков)

Каждый модуль = **2 параллельных задачи**: impl + test.

- **impl-агент** видит: контракт (interface + JSDoc) → реализует
- **test-агент** видит: контракт (interface + JSDoc) → пишет тесты

Они НЕ видят работу друг друга. Оба работают только по контракту.

```
                    Контракты (Phase 0)
                          │
            ┌─────────────┼─────────────┐
            ▼                           ▼
     [1.1a] Config impl          [1.1b] Config test
     [1.2a] LLM impl             [1.2b] LLM test
     [1.3a] Git impl             [1.3b] Git test
     [1.4a] Storage impl         [1.4b] Storage test
     [1.5a] StackDetect impl     [1.5b] StackDetect test
     [1.6a] Overlay capture impl [1.6b] Overlay capture test
     [1.7a] Proxy impl           [1.7b] Proxy test
     [1.8a] License impl         [1.8b] License test
     [1.9a] CLI scaffold impl    [1.9b] CLI scaffold test
     [1.10a] Classifier impl     [1.10b] Classifier test
     [1.11a] Extractors impl     [1.11b] Extractors test
     [1.12a] Overlay UI impl     [1.12b] Overlay UI test
```

### Формат задач

Каждая пара (a + b) описана ниже. Для краткости — одним блоком.

---

### 1.1a — Config reader IMPL

```
Контракт: IConfigReader
Пакет: packages/cli/src/
Файлы: config.ts
Реализует: read(), write(), exists() по JSDoc из контракта.
npm: @iarna/toml
```

### 1.1b — Config reader TEST

```
Контракт: IConfigReader
Пакет: packages/cli/src/__tests__/
Файлы: config.test.ts
Тестирует (по JSDoc):
- read() с валидным nova.toml → возвращает NovaConfig
- read() без nova.toml → все поля из DEFAULT_CONFIG
- read() с .nova/config.toml → мерж project + local
- read() с NOVA_API_KEY env → env перезаписывает config
- read() с невалидным TOML → бросает ConfigError с номером строки
- read() с port: -1 → бросает ConfigError с field='project.port'
- write() → создаёт nova.toml, пропускает default-значения
- exists() → true/false
Моки: нет (работает с реальной fs через tmp директории)
```

---

### 1.2a — LLM providers IMPL

```
Контракт: IProviderFactory + LlmClient
Пакет: packages/core/src/llm/
Файлы: AnthropicProvider.ts, OpenRouterProvider.ts, OpenAIProvider.ts, OllamaProvider.ts, ProviderFactory.ts
Реализует: chat(), chatWithVision(), stream() для каждого провайдера.
npm: @anthropic-ai/sdk, openai
```

### 1.2b — LLM providers TEST

```
Контракт: IProviderFactory + LlmClient (+ ProviderError)
Пакет: packages/core/src/llm/__tests__/
Файлы: anthropic.test.ts, openrouter.test.ts, openai.test.ts, ollama.test.ts, factory.test.ts
Тестирует (по JSDoc):
- Каждый provider: chat() форматирует HTTP-запрос правильно (заголовки, body)
- Каждый provider: chat() парсит ответ → возвращает string
- chatWithVision(): изображения кодируются в base64 в правильном формате
- stream(): возвращает AsyncIterable, yield-ит чанки
- HTTP 401 → бросает ProviderError с statusCode=401
- HTTP 429 → ретрай 1 раз через 1с → если опять 429 → ProviderError
- HTTP 500 → ProviderError
- options.responseFormat='json' → добавляет инструкцию в system prompt
- options.model → переопределяет модель
- ProviderFactory: 'anthropic' → AnthropicProvider instance
- ProviderFactory: 'unknown' → бросает ProviderError
- ProviderFactory: 'openrouter' без apiKey → бросает ProviderError
- ProviderFactory: 'ollama' без apiKey → ок (не нужен)
Моки: HTTP-запросы (msw или vitest mock fetch)
```

---

### 1.3a — Git manager IMPL

```
Контракт: IGitManager
Пакет: packages/core/src/git/
Файлы: GitManager.ts
Реализует: все методы через child_process.exec('git ...').
```

### 1.3b — Git manager TEST

```
Контракт: IGitManager (+ GitError)
Пакет: packages/core/src/git/__tests__/
Файлы: git.test.ts
Тестирует (по JSDoc):
- createBranch() → ветка создана, format: {prefix}{timestamp}
- createBranch() → текущая ветка переключилась
- createBranch() не в git-репо → GitError
- createBranch() с uncommitted changes → GitError
- commit() → коммит создан, возвращает 7-char hash
- commit([]) пустые файлы → stages all
- commit() без изменений → GitError
- rollback() → создан revert-коммит
- rollback() несуществующий hash → GitError
- getDiff() → возвращает unified diff string
- getLog() → CommitInfo[] отсортированный newest first, max 50
- getCurrentBranch() → имя ветки
- getDevCount() → число уникальных email-авторов
- hasUncommittedChanges() → true/false
- stash() + unstash() → работает roundtrip
- unstash() пустой стэш → GitError
Моки: нет (реальный tmp git repo, создаётся в beforeEach)
```

---

### 1.4a — Storage IMPL

```
Контракт: INovaDir, IGraphStore, ISearchRouter
Пакет: packages/core/src/storage/
Файлы: NovaDir.ts, GraphStore.ts, SearchRouter.ts
```

### 1.4b — Storage TEST

```
Контракт: INovaDir, IGraphStore, ISearchRouter
Пакет: packages/core/src/storage/__tests__/
Файлы: novaDir.test.ts, graphStore.test.ts, searchRouter.test.ts
Тестирует (по JSDoc):
NovaDir:
- init() создаёт .nova/ со всеми поддиректориями
- init() добавляет .nova в .gitignore
- init() идемпотентен (повторный вызов — ок)
- exists() → true после init, false до
- clean() удаляет .nova/
- getPath() → абсолютный путь

GraphStore:
- load() пустой файл → []
- load() файл не существует → []
- save() + load() → roundtrip
- upsertNode() новый → добавляет
- upsertNode() существующий → обновляет
- removeNode() → удаляет
- removeNode() несуществующий → no-op
- getImporters() → все кто импортирует файл
- getImports() → что файл импортирует
- getImports() несуществующий → []
- search() → находит по keyword (case-insensitive)
- search() → сортировка по количеству совпадений

SearchRouter:
- search() → возвращает SearchResult[] с matchType='keyword'
- search() → дедупликация по filePath
- search() → респектит limit
Моки: нет (реальная fs, tmp директории)
```

---

### 1.5a — Stack detector IMPL

```
Контракт: IStackDetector
Пакет: packages/core/src/indexer/
Файлы: StackDetector.ts
```

### 1.5b — Stack detector TEST

```
Контракт: IStackDetector
Пакет: packages/core/src/indexer/__tests__/
Файлы: stackDetector.test.ts
Фикстуры: tests/fixtures/ (из Phase 0.4)
Тестирует (по JSDoc):
- detectStack() на nextjs-app → { framework: 'next.js', language: 'typescript', packageManager: 'npm', typescript: true }
- detectStack() на vite-app → { framework: 'vite', ... }
- detectStack() на dotnet-app → { framework: 'dotnet', language: 'csharp', ... }
- detectStack() на empty-project → { framework: 'unknown', language: 'unknown', typescript: false }
- detectDevCommand() для next.js → 'npm run dev' (из package.json scripts)
- detectDevCommand() для dotnet → 'dotnet run'
- detectDevCommand() unknown → ''
- detectPort() для next.js → 3000 (default)
- detectPort() для vite → 5173 (default)
- detectPort() unknown → 3000
```

---

### 1.6a — Overlay capture IMPL

```
Контракт: IScreenshotCapture, IDomCapture, IVoiceCapture, IConsoleCapture
Пакет: packages/overlay/src/capture/
Файлы: ScreenshotCapture.ts, DomCapture.ts, VoiceCapture.ts, ConsoleCapture.ts
npm: html2canvas
```

### 1.6b — Overlay capture TEST

```
Контракт: IScreenshotCapture, IDomCapture, IVoiceCapture, IConsoleCapture
Пакет: packages/overlay/src/capture/__tests__/
Файлы: screenshot.test.ts, dom.test.ts, voice.test.ts, console.test.ts
Среда: jsdom + мок Web APIs
Тестирует (по JSDoc):
Screenshot:
- captureViewport() → вызывает html2canvas, возвращает Blob
- captureViewport() → resize если > 1920x1080

Dom:
- captureElement() → HTML string с 2 уровнями родителей
- captureElement() → strip noisy attributes (data-reactid, длинные class)
- captureElement() → добавляет computed styles
- captureElement() → результат < 2000 chars

Voice:
- start() → создаёт SpeechRecognition, continuous=true
- stop() → останавливает
- isListening() → true после start, false после stop
- onTranscript → callback вызывается с {text, isFinal}
- start() без Web Speech API → no-op, no error

Console:
- install() → перехватывает console.error
- console.error('test') → getErrors() содержит 'test'
- оригинальный console.error всё ещё вызывается
- max 20 ошибок, старые удаляются
- uninstall() → восстанавливает оригинал
- install() идемпотентен
```

---

### 1.7a — Proxy server IMPL

```
Контракт: IProxyServer, IWebSocketServer, IDevServerRunner
Пакет: packages/proxy/src/
Файлы: ProxyServer.ts, WebSocketServer.ts, DevServerRunner.ts
npm: http-proxy, ws
```

### 1.7b — Proxy server TEST

```
Контракт: IProxyServer, IWebSocketServer, IDevServerRunner
Пакет: packages/proxy/src/__tests__/
Файлы: proxy.test.ts, websocket.test.ts, devserver.test.ts
Тестирует (по JSDoc):
Proxy:
- start() → слушает на proxyPort
- HTTP GET через proxy → проксирует к targetPort
- HTML-ответ → содержит <script src="/nova-overlay.js">
- JSON-ответ → НЕ модифицирован
- CSS/JS-ответ → НЕ модифицирован
- GET /nova-overlay.js → возвращает файл по overlayScriptPath
- CSP-заголовки → стрипнуты
- stop() → порт освобождён
- isRunning() → true/false

WebSocket:
- start() → принимает WS-подключения на /nova-ws
- клиент отправляет Observation → onObservation callback вызван
- sendEvent() → клиент получает NovaEvent
- getClientCount() → 0, потом 1 после подключения

DevServer:
- spawn() → запускает процесс
- onReady → вызывается когда health check проходит
- getLogs() → содержит stdout
- kill() → процесс завершён
- isRunning() → true/false
- onError → вызывается если процесс упал
Моки: для proxy — реальный http-сервер на рандомном порту. Для devserver — `node -e "require('http').createServer(...)..."`
```

---

### 1.8a — License checker IMPL

```
Контракт: ILicenseChecker, ITelemetry
Пакет: packages/licensing/src/
Файлы: LicenseChecker.ts, Telemetry.ts
```

### 1.8b — License checker TEST

```
Контракт: ILicenseChecker, ITelemetry
Пакет: packages/licensing/src/__tests__/
Файлы: license.test.ts, telemetry.test.ts
Тестирует (по JSDoc):
License:
- 1 автор → { valid: true, tier: 'free', devCount: 1 }
- 3 автора → { valid: true, tier: 'free', devCount: 3 }
- 4 автора без ключа → { valid: false, tier: 'company', message: contains "Company license" }
- 4 автора с валидным ключом → { valid: true, tier: 'company' }
- 4 автора с невалидным ключом (плохой checksum) → { valid: false }
- Не git-репо → { valid: true, tier: 'free', devCount: 1 }
- Формат ключа: "NOVA-{base32}-{checksum}" → валидный
- Формат ключа: "invalid" → невалидный

Telemetry:
- send() → отправляет POST с правильным payload
- send() → projectHash = sha256(projectPath)
- NOVA_TELEMETRY=false → не отправляет (мок fetch не вызван)
- Сетевая ошибка → не бросает exception
- Timeout 3s → не бросает exception
Моки: git через tmp repo, HTTP через msw/mock fetch
```

---

### 1.9a — CLI scaffold IMPL

```
Контракт: нет формального (это UI/orchestration — описание поведения в Task 0.2)
Пакет: packages/cli/src/
Файлы: index.ts, setup.ts, commands/init.ts, commands/start.ts(stub), commands/chat.ts(stub),
        commands/status.ts, commands/tasks.ts(stub), commands/review.ts(stub), commands/watch.ts(stub)
npm: commander, inquirer, chalk, ora
```

### 1.9b — CLI scaffold TEST

```
Пакет: packages/cli/src/__tests__/
Файлы: cli.test.ts, setup.test.ts
Тестирует:
- `nova --version` → выводит версию из package.json
- `nova --help` → содержит все команды
- `nova init` → создаёт nova.toml
- `nova status` → не падает (выводит "No project indexed")
- `nova unknown` → показывает help + error
- setup: спрашивает provider → спрашивает ключ → сохраняет в .nova/config.toml
- setup: выбор ollama → не спрашивает ключ
Моки: inquirer (mock prompts), fs (tmp dir)
```

---

### 1.10a — Lane classifier IMPL

```
Контракт: ILaneClassifier
Пакет: packages/core/src/brain/
Файлы: LaneClassifier.ts
```

### 1.10b — Lane classifier TEST

```
Контракт: ILaneClassifier
Пакет: packages/core/src/brain/__tests__/
Файлы: classifier.test.ts
Тестирует (по JSDoc, все правила и edge cases):
Lane 1:
- "make button blue" + 1 файл → 1
- "change font size to 16px" + 1 файл → 1
- "change color to red" + 1 файл → 1
- "hide sidebar" + 1 файл → 1
- "set padding to 20px" + 1 файл → 1
- "change background color" + 1 файл → 1

Lane 2:
- "add search input to this component" + 1 файл → 2
- "add blue button" + 1 файл → 2 (это новый элемент, не CSS-правка!)
- "fix the login form validation" + 1 файл → 2
- чистый CSS-запрос но 2+ файла → 2 (не Lane 1 — несколько файлов)
- пустое описание → 2 (default)

Lane 3:
- "add user management page with API" + ["page.tsx", "route.ts"] → 3
- "create new component" + [] → 3
- "add endpoint for documents" + ["route.ts", "types.ts"] → 3

Lane 4:
- "refactor authentication module" + любые файлы → 4
- "migrate database to new schema" → 4
- "rewrite the dashboard" → 4

Performance: 1000 classifications < 100ms
```

---

### 1.11a — Route & component extractors IMPL

```
Контракт: IRouteExtractor, IComponentExtractor, IEndpointExtractor
Пакет: packages/core/src/indexer/
Файлы: RouteExtractor.ts, ComponentExtractor.ts, EndpointExtractor.ts
```

### 1.11b — Route & component extractors TEST

```
Контракт: IRouteExtractor, IComponentExtractor, IEndpointExtractor
Пакет: packages/core/src/indexer/__tests__/
Файлы: routeExtractor.test.ts, componentExtractor.test.ts, endpointExtractor.test.ts
Фикстуры: tests/fixtures/
Тестирует (по JSDoc):
Routes:
- nextjs-app: app/page.tsx → { path: '/', filePath: 'app/page.tsx', type: 'page' }
- nextjs-app: app/api/users/route.ts → { path: '/api/users', type: 'api' }
- empty-project → []

Components:
- vite-app: src/components/Button.tsx → { name: 'Button', type: 'component' }
- nextjs-app: app/page.tsx → { type: 'page' }
- hook useCustomers → { type: 'hook' }
- empty-project → []

Endpoints:
- nextjs-app API route → { method: 'GET', path: '/api/users' }
- dotnet-app controller → { method: 'GET', path: '/api/users' }
- empty-project → []
```

---

### 1.12a — Overlay UI IMPL

```
Контракт: IOverlayPill, ICommandInput, IElementSelector, IStatusToast
Пакет: packages/overlay/src/ui/
Файлы: OverlayPill.ts, CommandInput.ts, ElementSelector.ts, StatusToast.ts, styles.ts
```

### 1.12b — Overlay UI TEST

```
Контракт: IOverlayPill, ICommandInput, IElementSelector, IStatusToast
Пакет: packages/overlay/src/ui/__tests__/
Файлы: pill.test.ts, input.test.ts, selector.test.ts, toast.test.ts
Среда: jsdom
Тестирует (по JSDoc):
Pill:
- mount() → shadow DOM создан, элемент видим
- setState('listening') → пульсирующая зелёная анимация (class check)
- setState('error') → красный цвет
- onActivate → callback при клике
- unmount() → элемент удалён

Input:
- show() → видимый, focus на input
- hide() → скрыт
- Enter → onSubmit с текстом
- Escape → onClose
- setTranscript() → текст в поле обновляется
- Arrow Up → предыдущая команда из localStorage

Selector:
- activate() → isActive() = true
- hover элемент → элемент получает outline
- click → onSelect(element), deactivate
- Escape → onCancel, deactivate
- deactivate() → isActive() = false, outlines убраны

Toast:
- show('msg', 'info') → возвращает id, тост видим
- show('msg', 'success', 3000) → auto-dismiss через 3с
- show('msg', 'error') → НЕ auto-dismiss
- dismiss(id) → тост скрыт
- dismissAll() → все скрыты
- max 5 видимых → 6-й удаляет старейший
- onClick → callback с id
```

---

## Phase 2 — Интеграционные модули (параллельно, до 10 потоков)

Тот же паттерн: impl + test параллельно.

```
Phase 1 done
     │
     ├── [2.1a] Indexer impl        [2.1b] Indexer test
     ├── [2.2a] Brain impl          [2.2b] Brain test
     ├── [2.3a] Executor impl       [2.3b] Executor test
     ├── [2.4a] Overlay main impl   [2.4b] Overlay main test
     └── [2.5a] CLI start impl      [2.5b] CLI start test
```

---

### 2.1a — Project Indexer IMPL

```
Контракт: IProjectIndexer, IContextDistiller
Зависит от impl: StackDetector (1.5a), Extractors (1.11a), GraphStore (1.4a)
Пакет: packages/core/src/indexer/
Файлы: ProjectIndexer.ts, ContextDistiller.ts
npm: @swc/core, chokidar
```

### 2.1b — Project Indexer TEST

```
Контракт: IProjectIndexer, IContextDistiller
Пакет: packages/core/src/indexer/__tests__/
Файлы: projectIndexer.test.ts, contextDistiller.test.ts
Тестирует (по JSDoc):
- index() на nextjs-app → ProjectMap со stack, routes, components, endpoints
- index() сохраняет graph.json в .nova/
- index() генерирует compressedContext (non-empty string, < 3000 chars)
- update([changedFile]) → обновляет только этот узел в графе
- distill() → текст содержит framework, route count, key components
- distill() → < 3000 chars
Моки: нет (реальные фикстуры)
```

---

### 2.2a — Brain IMPL

```
Контракт: IBrain, ITaskDecomposer, IPromptBuilder
Зависит от impl: LlmClient (1.2a), LaneClassifier (1.10a)
Пакет: packages/core/src/brain/
Файлы: Brain.ts, TaskDecomposer.ts, PromptBuilder.ts
```

### 2.2b — Brain TEST

```
Контракт: IBrain, ITaskDecomposer, IPromptBuilder
Пакет: packages/core/src/brain/__tests__/
Файлы: brain.test.ts, decomposer.test.ts, promptBuilder.test.ts
Тестирует (по JSDoc):
Brain:
- analyze() → отправляет screenshot в chatWithVision
- analyze() → парсит JSON-ответ → TaskItem[]
- analyze() → каждый TaskItem имеет lane
- analyze() с невалидным JSON от LLM → retry → BrainError после 2 попыток

Decomposer:
- decompose(lane 3 task) → несколько subtasks с lane 1-2
- decompose(lane 2 task) → [task] без изменений (уже простой)

PromptBuilder:
- buildAnalysisPrompt() → содержит transcript, domSnapshot, compressedContext
- buildDecomposePrompt() → содержит task description, file list
Моки: LlmClient (возвращает предопределённый JSON)
```

---

### 2.3a — Executor Pool IMPL

```
Контракт: IExecutorPool, ILane1Executor, ILane2Executor, IDiffApplier, IValidator
Зависит от impl: LlmClient (1.2a), GitManager (1.3a)
Пакет: packages/core/src/executor/
Файлы: ExecutorPool.ts, Lane1Executor.ts, Lane2Executor.ts, DiffApplier.ts, Validator.ts
```

### 2.3b — Executor Pool TEST

```
Контракт: IExecutorPool, ILane1Executor, ILane2Executor, IDiffApplier, IValidator
Пакет: packages/core/src/executor/__tests__/
Файлы: executorPool.test.ts, lane1.test.ts, lane2.test.ts, diffApplier.test.ts, validator.test.ts
Тестирует (по JSDoc):
ExecutorPool:
- execute(lane 1 task) → вызывает Lane1Executor
- execute(lane 2 task) → вызывает Lane2Executor
- execute() emits task_started → task_completed events

Lane1:
- CSS-правка: "color: red → color: blue" → файл изменён
- Возвращает ExecutionResult с diff

Lane2:
- Загружает mini-context, отправляет в LLM
- Применяет diff, коммитит
- Возвращает ExecutionResult с diff + commitHash

DiffApplier:
- apply() валидный unified diff → файл изменён правильно
- apply() контекст не совпадает → DiffError
- apply() невалидный формат → DiffError
- apply() файл не существует → DiffError
- generate() → правильный unified diff

Validator:
- validate() TS-проект без ошибок → { valid: true, errors: [] }
- validate() TS-проект с ошибкой → { valid: false, errors: [...] }
- validate() проект без TS → пропускает tsc
Моки: LlmClient (для lane2), GitManager (для lane2), реальная fs для DiffApplier
```

---

### 2.4a — Overlay main IMPL

```
Контракт: связывает capture (ICapture) + UI (IOverlayUI) + WebSocket
Зависит от impl: Capture (1.6a), UI (1.12a)
Пакет: packages/overlay/src/
Файлы: index.ts, transport/WebSocketClient.ts
Бандл: tsup.config.ts
```

### 2.4b — Overlay main TEST

```
Пакет: packages/overlay/src/__tests__/
Файлы: integration.test.ts, websocket.test.ts
Тестирует:
- Весь pipeline: pill click → element select → dom capture + screenshot → Observation serialized
- WebSocketClient: connect → send → receive
- WebSocketClient: auto-reconnect при обрыве
- Получение task_completed event → toast показан
Моки: WebSocket (mock server), html2canvas, SpeechRecognition
```

---

### 2.5a — CLI start command IMPL

```
Контракт: orchestration (связывает всё)
Зависит от: Config (1.1a), License (1.8a), все Phase 2 impl модули
Пакет: packages/cli/src/commands/
Файлы: start.ts
```

### 2.5b — CLI start command TEST

```
Пакет: packages/cli/src/__tests__/
Файлы: start.test.ts
Тестирует:
- start() → вызывает в правильном порядке: config → license → init .nova → index → dev server → proxy → open browser
- observation event → brain.analyze вызван → executor.execute вызван
- task_completed → sendEvent в overlay
- Ctrl+C → graceful shutdown (kill dev server, stop proxy)
- Невалидная лицензия → показывает сообщение, работает в degraded mode
Моки: все зависимости (ProjectIndexer, DevServerRunner, ProxyServer, Brain, ExecutorPool)
```

---

## Phase 3 — E2E (1 поток)

### Task 3.1 — E2E integration tests

```
Зависит от: ВСЕ Phase 2
Пакет: tests/e2e/
Файлы: basic-flow.test.ts, smoke.test.ts

Тестирует:
- Smoke: `nova --version` выводит версию
- Smoke: `nova init` создаёт nova.toml
- E2E: nova запускается на fixture nextjs-app
  - proxy поднимается
  - overlay инжектится в HTML
  - WebSocket подключается
  - Mock observation → brain вызывается → task создаётся
- Build: `pnpm build` проходит без ошибок
- Bundle: overlay бандл < 50KB
- Полный `pnpm test` проходит
```

---

## Карта зависимостей

```
Phase 0 (sequential, 4 tasks):
  0.1 Scaffold → 0.2 Types → 0.3 Contracts → 0.4 EventBus + Fixtures

Phase 1 (24 parallel tasks = 12 impl + 12 test):
  1.1a Config impl      │  1.1b Config test
  1.2a LLM impl         │  1.2b LLM test
  1.3a Git impl          │  1.3b Git test
  1.4a Storage impl      │  1.4b Storage test
  1.5a StackDetect impl  │  1.5b StackDetect test
  1.6a Capture impl      │  1.6b Capture test
  1.7a Proxy impl        │  1.7b Proxy test
  1.8a License impl      │  1.8b License test
  1.9a CLI scaffold impl │  1.9b CLI scaffold test
  1.10a Classifier impl  │  1.10b Classifier test
  1.11a Extractors impl  │  1.11b Extractors test
  1.12a Overlay UI impl  │  1.12b Overlay UI test

Phase 1.5 (12 tasks — run tests against implementations):
  pnpm test for each module (impl + test merged)

Phase 2 (10 parallel tasks = 5 impl + 5 test):
  2.1a Indexer impl      │  2.1b Indexer test
  2.2a Brain impl        │  2.2b Brain test
  2.3a Executor impl     │  2.3b Executor test
  2.4a Overlay main impl │  2.4b Overlay main test
  2.5a CLI start impl    │  2.5b CLI start test

Phase 2.5 (5 tasks — run tests):
  pnpm test for each integration module

Phase 3 (1 task):
  3.1 E2E tests
```

---

## Суммарно

| Phase | Задачи | Параллельных потоков | Зависит от |
|-------|--------|---------------------|------------|
| 0 | 4 | 1 (последовательно) | — |
| 1 | 24 | 24 | Phase 0 |
| 1.5 | 12 | 12 (запуск тестов) | Phase 1 |
| 2 | 10 | 10 | Phase 1 |
| 2.5 | 5 | 5 (запуск тестов) | Phase 2 |
| 3 | 1 | 1 | Phase 2.5 |
| **Итого** | **56** | **max 24** | **6 последовательных шагов** |

---

## Инструкция для запуска

### Для impl-агента:

```
Ты реализуешь модуль {name}.

Контракт: {contract file path}
Пакет: {package path}
Файлы которые нужно создать: {file list}
npm зависимости: {deps}

Правила:
1. Реализуй ВСЕ методы из контракта
2. Следуй JSDoc описанию поведения точно
3. Экспортируй класс/функцию, реализующую интерфейс
4. Не пиши тесты — их пишет другой агент
5. Обрабатывай edge cases описанные в JSDoc (throws, default values)
```

### Для test-агента:

```
Ты пишешь тесты для модуля {name}.

Контракт: {contract file path}
Файл теста: {test file path}
Импорт реализации: import { ClassName } from '{module path}'

Правила:
1. Пиши тесты ТОЛЬКО по контракту (JSDoc описание поведения)
2. Не смотри реализацию — её пишет другой агент параллельно
3. Тестируй ВСЕ поведения описанные в JSDoc: happy path, edge cases, throws
4. Используй vitest (describe, it, expect)
5. Для fs-операций — используй tmp директории (beforeEach/afterEach cleanup)
6. Для HTTP — используй msw или vitest mock
7. Для browser APIs (jsdom) — мокай глобальные объекты
8. Каждый тест должен быть независимым (не зависеть от порядка запуска)
```
