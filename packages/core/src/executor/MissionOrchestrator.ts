import type { TaskItem, ProjectMap, MissionPlan, MissionFeature, Message, LlmOptions } from '../models/types.js';
import type { LlmClient } from '../contracts/ILlmClient.js';
import {
  CircularDependencyError,
  MissingDependencyError,
  type IOrchestrator,
} from '../contracts/IOrchestrator.js';
import type { ILogger } from '../contracts/ILogger.js';

// ── Orchestrator system prompt ────────────────────────────────────────

const ORCHESTRATOR_SYSTEM_PROMPT = `You are a task decomposition planner. Your job is to break down complex software engineering tasks into a structured plan of features with dependencies.

Given a task description and project context, you output a JSON mission plan with this exact structure:

{
  "features": [
    {
      "id": "unique-feature-id",
      "description": "What this feature implements",
      "files": ["project/relative/path.tsx", "another/file.ts"],
      "type": "multi_file",
      "dependencies": []  // IDs of features that must complete first
    }
  ]
}

RULES:
- Each feature MUST have a unique id (kebab-case, e.g. "auth-module", "login-page")
- files MUST be project-relative paths (no "../" traversal, no absolute paths)
- type must be one of: "css", "single_file", "multi_file", "refactor"
- dependencies must reference EXISTING feature IDs in the plan (no forward refs to undeclared features)
- Prefer independent features (empty dependencies) to enable parallel execution
- Features should be small and focused -- each feature should modify 1-5 files
- Break complex tasks into logical sub-tasks: data models, API routes, UI components, etc.
- Consider the project's framework, language, and existing routes when planning

Output ONLY the JSON object. No markdown, no explanations, no code fences.`;

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Resolve a relative file path to a safe, normalized project-relative path.
 * Strips "../" traversal components and leading "/" so the result is always
 * a clean path relative to the project root.
 */
export function sanitizeFilePath(rawPath: string): string {
  // Remove leading slash (absolute paths)
  const normalized = rawPath.replace(/^\/+/, '');

  // Split into segments and resolve ../
  const segments = normalized.split('/');
  const resolved: string[] = [];

  for (const seg of segments) {
    if (seg === '..') {
      // Pop the last segment if present (don't go above root)
      if (resolved.length > 0) {
        resolved.pop();
      }
      // If no segments to pop, the ".." is silently dropped (stay at root)
    } else if (seg === '.' || seg === '') {
      // Skip current dir and empty segments
      continue;
    } else {
      resolved.push(seg);
    }
  }

  return resolved.join('/');
}

/**
 * Extract a JSON object from text that may be wrapped in markdown code fences,
 * contain leading/trailing prose, or have other noise.
 */
function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  // Try extracting from ```json ... ``` or ``` ... ``` code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const inner = fenceMatch[1]!.trim();
    if (inner.length > 0) return inner;
  }

  // Try to find the first { and last } as a JSON object
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

/**
 * Validate that all feature IDs referenced in dependencies exist in the plan.
 * @throws {MissingDependencyError} if any dependency references a non-existent feature
 */
function validateDependencyReferences(features: MissionFeature[]): void {
  const featureIds = new Set(features.map((f) => f.id));

  for (const feature of features) {
    for (const depId of feature.dependencies) {
      if (!featureIds.has(depId)) {
        throw new MissingDependencyError(depId);
      }
    }
  }
}

/**
 * Detect circular dependencies using depth-first search.
 * @throws {CircularDependencyError} if a cycle is detected
 */
function detectCircularDependencies(features: MissionFeature[]): void {
  const featureMap = new Map<string, MissionFeature>();
  for (const f of features) {
    featureMap.set(f.id, f);
  }

  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current DFS path
  const BLACK = 2; // fully explored
  const color = new Map<string, number>();

  for (const f of features) {
    color.set(f.id, WHITE);
  }

  function dfs(featureId: string, path: string[]): void {
    const currentColor = color.get(featureId);
    if (currentColor === GRAY) {
      // Found a cycle — build the cycle path
      const cycleStart = path.indexOf(featureId);
      const cyclePath = path.slice(cycleStart).concat(featureId);
      throw new CircularDependencyError(cyclePath);
    }
    if (currentColor === BLACK) return;

    color.set(featureId, GRAY);
    path.push(featureId);

    const feature = featureMap.get(featureId);
    if (feature) {
      for (const depId of feature.dependencies) {
        dfs(depId, [...path]); // pass a copy since we need per-branch paths
      }
    }

    color.set(featureId, BLACK);
  }

  for (const f of features) {
    if (color.get(f.id) === WHITE) {
      dfs(f.id, []);
    }
  }
}

/**
 * Topologically sort features by dependency order (Kahn's algorithm).
 * Features with no dependencies come first; dependents follow their deps.
 */
function topologicalSort(features: MissionFeature[]): MissionFeature[] {
  const featureMap = new Map<string, MissionFeature>();
  for (const f of features) {
    featureMap.set(f.id, f);
  }

  // Compute in-degree for each feature
  const inDegree = new Map<string, number>();
  for (const f of features) {
    inDegree.set(f.id, f.dependencies.length);
  }

  // Build reverse dependency map (who depends on whom)
  const dependents = new Map<string, string[]>();
  for (const f of features) {
    dependents.set(f.id, []);
  }
  for (const f of features) {
    for (const depId of f.dependencies) {
      const list = dependents.get(depId);
      if (list) {
        list.push(f.id);
      }
    }
  }

  // Start with features that have no dependencies
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: MissionFeature[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = featureMap.get(currentId);
    if (current) {
      sorted.push(current);
    }

    const deps = dependents.get(currentId) ?? [];
    for (const depId of deps) {
      const newDegree = (inDegree.get(depId) ?? 1) - 1;
      inDegree.set(depId, newDegree);
      if (newDegree === 0) {
        queue.push(depId);
      }
    }
  }

  return sorted;
}

/**
 * Validate the structure of a raw parsed JSON object to ensure it matches
 * the MissionPlan schema. Returns a validated MissionPlan or throws.
 */
function validatePlanSchema(raw: unknown): MissionPlan {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Plan is not a valid JSON object');
  }

  const obj = raw as Record<string, unknown>;

  const rawFeatures = obj.features;
  if (!Array.isArray(rawFeatures)) {
    throw new Error('Plan must contain a "features" array');
  }

  const features: MissionFeature[] = [];
  const featuresArr: unknown[] = rawFeatures as unknown[];

  for (let i = 0; i < featuresArr.length; i++) {
    const item: unknown = featuresArr[i];

    if (typeof item !== 'object' || item === null) {
      throw new Error(`Feature at index ${i} is not a valid object`);
    }

    const f = item as Record<string, unknown>;

    // Validate id
    if (typeof f.id !== 'string' || f.id.trim().length === 0) {
      throw new Error(`Feature at index ${i} is missing a valid "id" field`);
    }

    // Validate description
    if (typeof f.description !== 'string') {
      throw new Error(`Feature "${f.id}" is missing a valid "description" field`);
    }

    // Validate files
    if (!Array.isArray(f.files)) {
      throw new Error(`Feature "${f.id}" has invalid "files" field (must be an array)`);
    }
    for (let j = 0; j < f.files.length; j++) {
      if (typeof f.files[j] !== 'string') {
        throw new Error(`Feature "${f.id}" file at index ${j} is not a string`);
      }
    }

    // Validate type
    const validTypes = new Set(['css', 'single_file', 'multi_file', 'refactor']);
    if (typeof f.type !== 'string' || !validTypes.has(f.type)) {
      throw new Error(
        `Feature "${f.id}" has invalid "type": "${String(f.type)}". Must be one of: css, single_file, multi_file, refactor`,
      );
    }

    // Validate dependencies
    const deps: string[] = [];
    if (f.dependencies !== undefined && f.dependencies !== null) {
      if (!Array.isArray(f.dependencies)) {
        throw new Error(`Feature "${f.id}" has invalid "dependencies" field (must be an array)`);
      }
      for (let j = 0; j < f.dependencies.length; j++) {
        if (typeof f.dependencies[j] !== 'string') {
          throw new Error(`Feature "${f.id}" dependency at index ${j} is not a string`);
        }
        deps.push(f.dependencies[j] as string);
      }
    }

    features.push({
      id: f.id,
      description: f.description,
      files: (f.files as string[]).map(sanitizeFilePath),
      type: f.type as MissionFeature['type'],
      dependencies: deps,
    });
  }

  return { features };
}

// ── Prompt Builder ────────────────────────────────────────────────────

function buildPlanPrompt(task: TaskItem, projectMap: ProjectMap): string {
  const parts: string[] = [];

  // Task description
  parts.push(`## Task Description\n${task.description}`);

  if (task.files.length > 0) {
    parts.push(`\n## Target Files\n${task.files.join(', ')}`);
  }

  // Project stack info
  parts.push(`\n## Project Stack`);
  parts.push(`- Framework: ${projectMap.stack.framework}`);
  parts.push(`- Language: ${projectMap.stack.language}`);
  if (projectMap.stack.packageManager) {
    parts.push(`- Package Manager: ${projectMap.stack.packageManager}`);
  }
  if (projectMap.stack.typescript) {
    parts.push('- TypeScript: yes');
  }

  // Routes
  if (projectMap.routes.length > 0) {
    parts.push('\n## Existing Routes');
    for (const route of projectMap.routes) {
      parts.push(`- ${route.type.toUpperCase()} ${route.path} -> ${route.filePath}`);
    }
  }

  // Existing files
  const allFiles = Array.from(projectMap.fileContexts.keys()).sort();
  if (allFiles.length > 0) {
    parts.push('\n## Existing Files');
    for (const filePath of allFiles) {
      parts.push(`- ${filePath}`);
    }
  }

  // Package dependencies
  const pkgCtx = projectMap.fileContexts.get('package.json');
  if (pkgCtx) {
    try {
      const pkg = JSON.parse(pkgCtx.content) as Record<string, unknown>;
      const pkgDeps = (pkg.dependencies as Record<string, unknown>) ?? {};
      const pkgDevDeps = (pkg.devDependencies as Record<string, unknown>) ?? {};
      const deps = Object.keys({ ...pkgDeps, ...pkgDevDeps }).sort();
      if (deps.length > 0) {
        parts.push(`\n## Available Packages\n${deps.join(', ')}`);
      }
    } catch {
      /* skip invalid package.json */
    }
  }

  // Output format instructions
  parts.push('\n## Output Format');
  parts.push('Respond with ONLY a JSON object matching this structure:');
  parts.push('```json');
  parts.push('{');
  parts.push('  "features": [');
  parts.push('    {');
  parts.push('      "id": "kebab-case-id",');
  parts.push('      "description": "What this feature implements",');
  parts.push('      "files": ["path/to/file.tsx"],');
  parts.push('      "type": "multi_file",');
  parts.push('      "dependencies": []');
  parts.push('    }');
  parts.push('  ]');
  parts.push('}');
  parts.push('```');

  return parts.join('\n');
}

// ── MissionOrchestrator ────────────────────────────────────────────────

export class MissionOrchestrator implements IOrchestrator {
  constructor(
    private readonly llmClient: LlmClient,
    private readonly orchestratorModel: string,
    private readonly logger?: ILogger,
  ) {}

  async plan(task: TaskItem, projectMap: ProjectMap): Promise<MissionPlan> {
    const taskLog = this.logger?.child({ taskId: task.id });

    taskLog?.info('MissionOrchestrator: building plan prompt', {
      taskId: task.id,
      model: this.orchestratorModel,
    });

    // Build the prompt
    const prompt = buildPlanPrompt(task, projectMap);

    // Combine system + user into a single message
    const fullPrompt = `${ORCHESTRATOR_SYSTEM_PROMPT}\n\n---\n\n${prompt}`;

    // Call the orchestrator LLM
    const messages: Message[] = [{ role: 'user', content: fullPrompt }];
    const options: LlmOptions = {
      model: this.orchestratorModel,
      temperature: 0,
      responseFormat: 'json',
    };

    let responseText: string;
    try {
      const response = await this.llmClient.chat(messages, options);
      responseText = response.content;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      taskLog?.error('MissionOrchestrator: LLM call failed', {
        taskId: task.id,
        error: errorMsg,
      });
      throw new Error(`Orchestrator LLM call failed: ${errorMsg}`, { cause: error });
    }

    taskLog?.info('MissionOrchestrator: LLM responded', {
      taskId: task.id,
      responseLength: responseText.length,
    });

    // Handle empty response
    const trimmed = responseText.trim();
    if (trimmed.length === 0) {
      taskLog?.warn('MissionOrchestrator: empty LLM response, returning empty plan', {
        taskId: task.id,
      });
      return { features: [] };
    }

    // Extract JSON from response
    const jsonStr = extractJsonObject(responseText);
    if (!jsonStr) {
      throw new Error(
        'Orchestrator LLM response did not contain valid JSON. Expected a JSON object with a "features" array.',
      );
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error(
        `Orchestrator LLM response contained invalid JSON: ${jsonStr.slice(0, 200)}`,
      );
    }

    // Validate schema
    const plan = validatePlanSchema(parsed);

    taskLog?.info('MissionOrchestrator: parsed plan', {
      taskId: task.id,
      featureCount: plan.features.length,
    });

    // If empty features, return as-is
    if (plan.features.length === 0) {
      return plan;
    }

    // Validate dependency references
    validateDependencyReferences(plan.features);

    // Detect circular dependencies
    detectCircularDependencies(plan.features);

    // Topologically sort
    const sorted = topologicalSort(plan.features);

    taskLog?.info('MissionOrchestrator: plan validated and sorted', {
      taskId: task.id,
      featureCount: sorted.length,
      order: sorted.map((f) => f.id),
    });

    return { features: sorted };
  }
}
