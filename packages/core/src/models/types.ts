import type { Manifest } from './manifest.js';

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
  frontend?: string;
  backends?: string[];
  manifest?: Manifest;
}

// ============================================================
// Observation (overlay -> proxy -> core)
// ============================================================

export interface Observation {
  screenshot: Buffer;
  clickCoords?: { x: number; y: number };
  domSnapshot?: string;
  transcript?: string;
  currentUrl: string;
  consoleErrors?: string[];
  timestamp: number;
  gestureContext?: {
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
      region?: { x: number; y: number; width: number; height: number };
    }>;
    summary: string;
  };
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

export interface TeamInfo {
  devCount: number;
  windowDays: number;
  botsFiltered: number;
}

export interface TeamDetectOptions {
  windowDays?: number;
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
  snippet?: string;
}

// ============================================================
// Method extraction & project analysis
// ============================================================

export type MethodVisibility = 'public' | 'private' | 'protected';

export interface MethodInfo {
  name: string;
  filePath: string;
  className?: string;
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
// RAG / Embeddings
// ============================================================

export interface EmbeddingRecord {
  id: string;
  filePath: string;
  chunkText: string;
  embedding: number[];
  metadata: {
    type: 'method' | 'imports' | 'types' | 'general';
    name?: string;
    lineStart?: number;
    lineEnd?: number;
  };
}
