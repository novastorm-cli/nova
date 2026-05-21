import type { Manifest } from './manifest.js';

// ============================================================
// Stack & Indexer
// ============================================================

export interface StackInfo {
  framework: string; // "next.js", "vite", "dotnet", "django", etc.
  language: string; // "typescript", "javascript", "csharp", "python"
  packageManager?: string | undefined; // "npm", "yarn", "pnpm", "bun"
  typescript: boolean;
  additionalStacks?: string[] | undefined; // other detected frameworks e.g. ["dotnet", "express"]
}

export interface DockerServiceInfo {
  name: string;
  ports: Array<{ host: number; container: number }>;
  buildContext?: string | undefined;
  image?: string | undefined;
}

export interface RouteInfo {
  path: string; // "/dashboard", "/api/users"
  filePath: string; // "app/dashboard/page.tsx"
  type: 'page' | 'api' | 'layout';
  methods?: string[] | undefined; // for API: ["GET", "POST"]
}

export interface ComponentInfo {
  name: string; // "CustomerTable"
  filePath: string; // "components/CustomerTable.tsx"
  type: 'component' | 'page' | 'layout' | 'hook';
  exports: string[]; // exported symbol names
  props?: string[] | undefined; // prop names if detectable
}

export interface EndpointInfo {
  method: string; // "GET", "POST", etc.
  path: string; // "/api/users"
  filePath: string;
  handler?: string | undefined; // function/method name
}

export interface ModelInfo {
  name: string; // "User", "Transaction"
  filePath: string;
  fields?: string[] | undefined;
}

export interface DependencyNode {
  filePath: string;
  imports: string[];
  exports: string[];
  type: 'component' | 'page' | 'api' | 'model' | 'hook' | 'util' | 'config';
  route?: string | undefined;
  keywords: string[];
}

export type DependencyGraph = Map<string, DependencyNode>;

export interface MiniContext {
  filePath: string;
  content: string;
  importedTypes: string; // concatenated type definitions from imports
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
  frontend?: string | undefined;
  backends?: string[] | undefined;
  manifest?: Manifest | undefined;
  /** If set, the indexer hit the file cap and only indexed a subset */
  cappedAt?: number | undefined;
}

// ============================================================
// Observation (overlay -> proxy -> core)
// ============================================================

export interface Observation {
  screenshot: Buffer;
  clickCoords?: { x: number; y: number } | undefined;
  domSnapshot?: string | undefined;
  transcript?: string | undefined;
  currentUrl: string;
  consoleErrors?: string[] | undefined;
  timestamp: number;
  gestureContext?:
    | {
        gestures: Array<{
          type: string;
          startTime: number;
          endTime: number;
          elements: Array<{
            tagName: string;
            selector: string;
            domSnippet: string;
            role: string;
          }>;
          region?: { x: number; y: number; width: number; height: number } | undefined;
        }>;
        summary: string;
      }
    | undefined;
  selectedArea?:
    | {
        x: number;
        y: number;
        width: number;
        height: number;
        screenshot?: Buffer | undefined;
      }
    | undefined;
}

// ============================================================
// Tasks
// ============================================================

export type TaskType = 'css' | 'single_file' | 'multi_file' | 'refactor';
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'rolled_back';
export type Lane = 1 | 2 | 3 | 4 | 5;

export interface TaskItem {
  id: string;
  description: string;
  files: string[];
  type: TaskType;
  lane: Lane;
  status: TaskStatus;
  commitHash?: string | undefined;
  diff?: string | undefined;
  error?: string | undefined;
  /** When true, the task was explicitly initiated by user action (Quick Edit, Multi-Edit)
   * and can skip the confirmation gate. */
  preConfirmed?: boolean | undefined;
  /** DOM snapshot of the selected element (Quick Edit / Multi-Edit target).
   * Used by Lane1Executor to scope CSS/text changes to the correct element. */
  domSnapshot?: string | undefined;
}

export interface ExecutionResult {
  success: boolean;
  taskId: string;
  diff?: string | undefined;
  commitHash?: string | undefined;
  error?: string | undefined;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ file: string; line?: number | undefined; message: string }>;
}

// ============================================================
// LLM
// ============================================================

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  model?: string | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  responseFormat?: 'text' | 'json' | undefined;
}

/** Normalized response from a provider chat call. */
export interface ChatResponse {
  content: string;
  /** Optional chain-of-thought / reasoning content (e.g., DeepSeek reasoning_content). */
  reasoningContent?: string | undefined;
}

/** Normalized stream chunk from a provider streaming call. */
export interface StreamChunk {
  content: string;
  /** Optional chain-of-thought / reasoning content (e.g., DeepSeek delta.reasoning_content). */
  reasoningContent?: string | undefined;
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
  message?: string | undefined;
}

export interface TeamInfo {
  devCount: number;
  windowDays: number;
  botsFiltered: number;
}

export interface TeamDetectOptions {
  windowDays?: number | undefined;
}

export interface TelemetryPayload {
  machineId: string;
  gitAuthors90d: number;
  projectHash: string;
  cliVersion: string;
  os: string;
  timestamp: string;
  licenseKey: string | null;
}

export type NudgeLevel = 0 | 1 | 2 | 3;

export interface NudgeContext {
  level: NudgeLevel;
  devCount: number;
  tier: LicenseTier;
  hasLicense: boolean;
}

export interface TelemetryResponse {
  nudgeLevel: NudgeLevel;
}

// ============================================================
// Search
// ============================================================

export interface SearchResult {
  filePath: string;
  score: number;
  matchType: 'graph' | 'keyword' | 'semantic';
  snippet?: string | undefined;
}

// ============================================================
// Method extraction & project analysis
// ============================================================

export type MethodVisibility = 'public' | 'private' | 'protected';

export interface MethodInfo {
  name: string;
  filePath: string;
  className?: string | undefined;
  signature: string;
  purpose: string;
  lineStart: number;
  lineEnd: number;
  visibility: MethodVisibility;
  isAsync: boolean;
}

export interface ProjectAnalysis {
  frontendSummary: string;
  backendSummary: string;
  methods: MethodInfo[];
  analyzedAt: string;
  fileCount: number;
}

// ============================================================
// Fullstack Graph
// ============================================================

export type FullstackNodeType =
  | 'component'
  | 'page'
  | 'api_endpoint'
  | 'db_model'
  | 'middleware'
  | 'hook';

export interface FullstackEdge {
  from: string; // source node ID (filePath:name)
  to: string; // target node ID
  type: 'fetches' | 'imports' | 'queries' | 'middleware' | 'renders';
  metadata?: Record<string, string> | undefined;
}

export interface FullstackNode {
  id: string; // filePath:name (unique)
  name: string;
  filePath: string;
  type: FullstackNodeType;
  layer: 'frontend' | 'backend' | 'database';
  metadata: Record<string, unknown>;
}

export interface FullstackGraph {
  nodes: FullstackNode[];
  edges: FullstackEdge[];
}

// ============================================================
// RAG / Embeddings
// ============================================================

export interface EmbeddingRecord {
  id: string;
  filePath: string;
  chunkText: string;
  embedding: number[];
  metadata: {
    type: 'method' | 'imports' | 'types' | 'general';
    name?: string | undefined;
    lineStart?: number | undefined;
    lineEnd?: number | undefined;
  };
}

// ============================================================
// Passive Ambient
// ============================================================

export interface BehaviorEvent {
  type: 'page_visit' | 'click' | 'scroll' | 'api_call' | 'error' | 'sort' | 'filter';
  url: string;
  target?: string | undefined; // CSS selector or element description
  metadata?: Record<string, string> | undefined;
  timestamp: number;
  duration?: number | undefined; // time on page in ms
}

export interface BehaviorPattern {
  id: string;
  type: 'frequent_page' | 'repeated_action' | 'slow_api' | 'recurring_error' | 'unused_feature';
  description: string;
  confidence: number; // 0-1
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
  metadata: Record<string, unknown>;
}

export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface PassiveSuggestion {
  id: string;
  pattern: BehaviorPattern;
  title: string;
  description: string;
  suggestedTasks: Array<{
    description: string;
    type: TaskType;
    estimatedLane: Lane;
  }>;
  status: SuggestionStatus;
  createdAt: number;
  respondedAt?: number | undefined;
}

// ============================================================
// Background Queue (Lane 4)
// ============================================================

export type BackgroundTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface BackgroundTask {
  id: string;
  task: TaskItem;
  status: BackgroundTaskStatus;
  queuedAt: number;
  startedAt?: number | undefined;
  completedAt?: number | undefined;
  branch?: string | undefined;
  commitHash?: string | undefined;
  diff?: string | undefined;
  error?: string | undefined;
  progress?: string | undefined;
}

// ============================================================
// History
// ============================================================

export interface HistoryEntry {
  id: string;
  taskId: string;
  description: string;
  type: TaskType;
  lane: Lane;
  status: TaskStatus;
  filesChanged: string[];
  commitHash?: string | undefined;
  diff?: string | undefined;
  error?: string | undefined;
  startedAt: number;
  completedAt?: number | undefined;
}

// ============================================================
// Recipes
// ============================================================

export interface Recipe {
  id: string;
  name: string;
  description: string;
  category: 'crud_endpoint' | 'form_field' | 'new_page' | 'component' | 'api_route' | 'custom';
  template: RecipeTemplate;
  tags: string[];
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface RecipeTemplate {
  files: RecipeFileTemplate[];
  variables: RecipeVariable[];
}

export interface RecipeFileTemplate {
  pathPattern: string; // e.g. "app/api/{name}/route.ts"
  content: string; // template with {{variable}} placeholders
  action: 'create' | 'modify';
}

export interface RecipeVariable {
  name: string;
  description: string;
  defaultValue?: string | undefined;
  required: boolean;
}

// ============================================================
// Mission (Lane 5)
// ============================================================

export type MissionStatus =
  | 'planning'
  | 'awaiting_confirmation'
  | 'executing'
  | 'reviewing'
  | 'completed'
  | 'failed';

export interface MissionFeature {
  id: string;
  description: string;
  files: string[];
  type: TaskType;
  /** Feature IDs that must complete before this feature can start. */
  dependencies: string[];
}

export interface MissionPlan {
  features: MissionFeature[];
}

export interface FeatureResult {
  success: boolean;
  featureId: string;
  diff?: string | undefined;
  generatedFiles?: Array<{ path: string; content: string }> | undefined;
  deletedFiles?: string[] | undefined;
  validationErrors?: Array<{ file: string; line?: number | undefined; message: string }> | undefined;
  fixIterations?: number | undefined;
  /** Paths rejected by PathGuard during block application. */
  rejectedPaths?: Array<{ path: string; reason: string }> | undefined;
  error?: string | undefined;
}

export type DirectorDecision = 'APPROVED' | 'NEEDS_REVISION' | 'REJECTED';

export interface DirectorVerdict {
  decision: DirectorDecision;
  feedback: Array<{
    featureId: string;
    actionItems: string[];
  }>;
}

export interface MissionState {
  id: string;
  taskId: string;
  status: MissionStatus;
  plan?: MissionPlan | undefined;
  featureResults: Record<string, FeatureResult>;
  directorVerdict?: DirectorVerdict | undefined;
  iteration: number;
  maxIterations: number;
}
