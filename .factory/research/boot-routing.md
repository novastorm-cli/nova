# Nova CLI Boot & Event Routing — Detailed Analysis

Generated: 2026-05-21

---

## 1. CLI `start.ts` — Boot Sequence & Wiring

**File:** `packages/cli/src/commands/start.ts` (~570 lines)

The `startCommand()` function is the main CLI entry point. It wires together **all** core components in a 17-step sequential boot pipeline:

### Step-by-step boot sequence

| Step | What happens | Key components instantiated |
|------|-------------|---------------------------|
| 1 | Config & license | `ConfigReader`, `LicenseChecker` |
| 2 | Telemetry (fire-and-forget) | `sendBootTelemetry()` |
| 3 | LLM provider setup | `ProviderFactory` → `llmClient`, `Brain` |
| 4 | Stack detection | `StackDetector` → framework, language, dev command/port |
| 5 | Scaffold if needed | `runScaffold()` (prompts for empty dirs) |
| 6 | `.nova/` init & project index | `NovaDir.init()`, `ProjectIndexer.index()` |
| 7 | RAG indexing | `RagIndexer`, `VectorStore`, `createEmbeddingService` |
| 8 | Project analysis | `ProjectAnalyzer`, `ProjectMapApi` |
| 9 | Port acquisition | `PortManager` (resolve conflicts) |
| 10 | Dependency install | `ensureDependencies()` |
| 11 | Dev server spawn | `DevServerRunner.spawn()` |
| 12 | Proxy & WebSocket | `ProxyServer`, `WebSocketServer` |
| 13 | Browser open | `openBrowser()` |
| 14 | Git init & branch | `GitManager` |
| 15 | Executor pool & autofixer | `ExecutorPool`, `Lane1Executor`, `Lane2Executor`, `CommitQueue`, `ErrorAutoFixer` |
| 16 | Event routing | `setupEventRouting()` — **the central nervous system** |
| 17 | Chat & shutdown | `NovaChat`, signal handlers |

### Component relationships

```
Observation (from overlay via WS)
    ↓
EventRouter.setupEventRouting()
    ↓ wsServer.onObservation → eventBus.emit('observation')
    ↓ eventBus.on('observation')
Brain.analyze(observation, projectMap)
    ↓ returns TaskItem[]
EventRouter — either auto-execute or emit 'pending_tasks' for confirmation
    ↓ confirmed
ExecutorPool.execute(task, projectMap)
    ↓ routes to Lane1/Lane2/Lane3/Lane4
    ↓ emits task_started/task_completed/task_failed
    ↓ forwarded by EventRouter → wsServer.sendEvent() → overlay TaskPanel
```

### Where Lane 5 initialization would go

**Between steps 14 and 15** — after Git is ready but before the main ExecutorPool is created. Alternatively, it could be part of step 15 itself since the `ExecutorPool` constructor already accepts an optional `lane4` parameter:

```typescript
// In start.ts, around line 410 (step 15):
executorPool = new ExecutorPool(
  new Lane1Executor(cwd, pathGuard),
  new Lane2Executor(cwd, llmClient, gitManager, pathGuard, commitQueue),
  eventBus,
  undefined,       // logger
  llmClient,
  gitManager,
  cwd,
  config.models.micro,
  config.models.standard,
  config.models.strong,
  agentPromptLoader,
  pathGuard,
  undefined,       // lane4 — same pattern could add lane5 here
  commitQueue,
);
```

The `ExecutorPool` would need a new constructor parameter `lane5?: Lane5Executor` and a new `case 5:` branch in its `execute()` switch statement.

---

## 2. EventRouter — Observation → Task Pipeline

**File:** `packages/cli/src/boot/EventRouter.ts` (~345 lines)

### Core Architecture

`setupEventRouting(deps: EventRouterDeps)` is a function (not a class) that wires up all event handlers. It takes a dependency-injection style object with 12 fields.

### Key Flows

#### A. Observation → Brain → Tasks (the main loop)

```
wsServer.onObservation(observation)
  → logger.logObservation()
  → eventBus.emit({ type: 'observation', data: {...observation, autoExecute} })

eventBus.on('observation', async (event) =>
  → Check for revert/undo commands (regex → git revert, short-circuit)
  → brain.analyze(event.data, projectMap) → TaskItem[]
  → If tasks.length === 0: return (AI asked a question)
  → Check confirmation mode:
      isPreConfirmed = event.data.autoExecute === true
      shouldAutoExecute = isNonInteractive || !confirmTasks || isPreConfirmed
  → If shouldAutoExecute: executeTasks(tasks) directly
  → Else: store in deps.pendingTasks, emit 'pending_tasks' to overlay
```

#### B. Execution with concurrency control

```typescript
function executeTasks(tasks: TaskItem[]): void {
  for (const task of tasks) {
    eventBus.emit({ type: 'task_created', data: task });
  }
  if (!executorPool) return;
  // Run up to 3 tasks concurrently
  runWithConcurrency(taskFns, MAX_TASK_CONCURRENCY); // MAX_TASK_CONCURRENCY = 3
}
```

#### C. Confirmation handlers

- `wsServer.onConfirm()` — executes all `deps.pendingTasks`
- `wsServer.onConfirmTasks(taskIds?)` — confirms via overlay UI
- `wsServer.onCancel()` — clears `deps.pendingTasks`
- `wsServer.onAppend(text)` — merges additional text into observation, re-runs brain.analyze()
- `wsServer.onRevertFile(filePath)` — cancels pending tasks for a reverted file

#### D. Task event forwarding to overlay

```
eventBus.on('task_created')   → wsServer.sendEvent(event)
eventBus.on('task_started')   → wsServer.sendEvent(event)
eventBus.on('task_completed') → wsServer.sendEvent(event) + post-task health check
eventBus.on('task_failed')    → wsServer.sendEvent(event)
eventBus.on('file_changed')   → wsServer.sendEvent(event)
eventBus.on('llm_chunk')      → wsServer.sendEvent(event)  (streaming LLM responses)
eventBus.on('secrets_required') → wsServer.sendEvent(event)
eventBus.on('status')         → wsServer.sendEvent(event)
```

#### E. Post-task health check (after task_completed)

After each task completes, a 1.5s timeout checks:
1. Dev server logs for new errors → triggers `autoFixer.forceFixNow()`
2. HTTP health check on the dev port → auto-fixes on 5xx responses

#### F. Startup health check (4s timer in start.ts)

Separate from EventRouter — directly in `start.ts`. Detects build errors at startup, routes to autofixer (bypasses Brain to avoid clarifying questions).

---

## 3. Brain — Observation Decomposition

**File:** `packages/core/src/brain/Brain.ts` (~160 lines)

### How it works

```typescript
class Brain implements IBrain {
  async analyze(observation: Observation, projectMap: ProjectMap): Promise<TaskItem[]>
}
```

1. **Builds prompt** via `PromptBuilder.buildAnalysisPrompt()`:
   - System: "You are a JSON-only task decomposition API"
   - User message includes: transcript, click coordinates, DOM snapshot, gesture context, current URL, service architecture, manifest, compressed project context, RAG snippets
   - Vision: if provider supports it, screenshot is passed via `chatWithVision()`

2. **Sends to LLM** with `responseFormat: 'json'`, up to 2 retries (MAX_ATTEMPTS=2). Falls back to text-only if provider throws `NO_VISION_SUPPORT`.

3. **Parses response** via `parseJsonArray()`:
   - Option A: Tasks — `[{"description":"...","files":[...],"type":"..."}]`
   - Option B: Clarifying question — `[{"question":"..."}]` → returns empty array

4. **Converts to TaskItems** via `toTaskItems()`:
   - Assigns `id` (crypto.randomUUID()), `status: 'pending'`
   - Classifies lane via `LaneClassifier.classify()`
   - Filters out binary-file tasks (images, fonts, etc.)
   - Filters out tasks that ask to create/add binary files

### LaneClassifier (rule-based, < 1ms)

**File:** `packages/core/src/brain/LaneClassifier.ts`

| Rule | Condition | Lane |
|------|-----------|------|
| 4 (highest) | refactor/migrate/rewrite/redesign/restructure/upgrade keywords | 4 |
| 3 | add.*page / new.*endpoint / create.*component keywords | 3 |
| 1 | Style keywords (color/font/margin etc.) + no "add/create/new" + ≤1 file | 1 |
| 2 | Style keywords + no "add/create/new" + >1 file | 2 |
| 3 | >1 file (non-style change) | 3 |
| 2 (default) | Single file | 2 |

### PromptBuilder

**File:** `packages/core/src/brain/PromptBuilder.ts`

- `buildAnalysisPrompt()` — the main analysis prompt used by Brain
- `buildDecomposePrompt()` — used by TaskDecomposer for Lane 3+ tasks
- `setRagSnippets()` — injects RAG-retrieved code context

### Would an orchestrator replace or supplement the Brain?

**Supplement.** The Brain is a single-call decomposition engine: observation → LLM → TaskItem[]. An orchestrator would sit **above** the Brain, handling:

- **Multi-step mission planning**: Instead of one observation → tasks, it would manage a multi-turn conversation/plan (e.g., "build a login page" → plan steps → execute each → verify → continue)
- **Worker agent dispatch**: After decomposition, route each task/subtask to specialized worker agents (developer, tester, director) following the CLAUDE.md workflow
- **Stateful mission tracking**: Persist mission state, progress, and results across multiple executor calls
- **Feedback loops**: Collect results from workers, feed back into planning

The Brain would remain as the initial decomposition step within the orchestrator's pipeline.

---

## 4. All Boot Files — Summary

**Directory:** `packages/cli/src/boot/` (9 files + `__tests__/`)

| File | Lines | Purpose |
|------|-------|---------|
| `EventRouter.ts` | ~345 | Core event wiring: WS ↔ EventBus ↔ Brain ↔ Executor (described above) |
| `Installer.ts` | ~240 | Ensures `node_modules` exists for Node projects. Handles `npm/pnpm/yarn install` failures with interactive recovery (AI fix, JSON fix, skip) |
| `PortKiller.ts` | ~240 | Node-native TCP port killer. Linux: `/proc/net/tcp` → inode → PID. macOS: `netstat -anv -p tcp`. Zero subprocesses on Linux. |
| `PortManager.ts` | ~100 | Port probing (`net.createServer`), killing (`PortKiller`), free-pair scanning |
| `ScaffoldRunner.ts` | ~160 | Scaffolds empty directories or discovers dev commands for existing projects. Saves to `nova.toml`. |
| `TelemetryEmitter.ts` | ~80 | Fire-and-forget boot-ping with machine ID, project hash, license info. Uses `@novastorm-ai/licensing` Telemetry + NudgeRenderer. |
| `BrowserOpener.ts` | ~30 | Cross-platform browser opener using the `open` npm package. Respects `--no-open`. |
| `utils.ts` | ~8 | Single function: `isNonInteractive(options)` — checks `NOVA_NON_INTERACTIVE=1` or `--yes` |
| `__tests__/` | — | Test directory for boot modules |

---

## 5. Overlay TaskPanel — Task Display

**File:** `packages/overlay/src/ui/TaskPanel.ts` (~370 lines)

### Data it expects

#### For pending tasks (`setPendingTasks`):
```typescript
Array<{
  id: string;
  description: string;
  lane: number;
  preConfirmed?: boolean;  // if true, shows "AUTO" chip instead of "AWAITING"
}>
```

#### For live updates:
- `addTask({id, description, lane})` — add single task without clearing
- `setTaskStarted(taskId)` — status → "executing" (fast spinner icon)
- `setTaskCompleted(taskId, commitHash)` — status → "completed" (checkmark icon, shows 7-char commit hash)
- `setTaskFailed(taskId, error)` — status → "failed" (X icon, shows truncated error)
- `setStreamingText(taskId, text, phase)` — append LLM streaming text to task row (monospace, scrollable, max 100px)

#### Task row display structure:
```
[icon] [description text...] [confirmation chip] [meta]
```

- **Icons**: pending=spinning circle, executing=faster spinning circle, completed=checkmark (draw animation), failed=X
- **Confirmation chips**: "AWAITING" (yellow, pending), "AUTO" (accent, preConfirmed), "CONFIRMED" (green, executing)
- **Meta**: 7-char commit hash (completed) or error prefix (failed), shown in monospace

### Lifecycle & state

- **sessionStorage**: restores task state on hot reload (unless all tasks are terminal)
- **localStorage**: persists completed/failed tasks (up to 20) in `nova:recent-tasks` for history view
- **Auto-hide**: 5s after all tasks reach terminal state (unless hovering)
- **History mode**: `showHistory()` displays past tasks from localStorage
- **Close button**: × in title bar immediately clears all tasks

### Layout integration

Registered in the bottom-left slot stack (bottom → top):
```
ActivityLog → SuggestionPanel → TaskPanel
```

### How it receives events (from overlay `index.ts`):

```
WS Event               → TaskPanel method
─────────────────────────────────────────
'pending_tasks'        → setPendingTasks(tasks)
'task_created'         → addTask({id, description, lane})
'task_started'         → setTaskStarted(taskId)
'task_completed'       → setTaskCompleted(taskId, commitHash)
'task_failed'          → setTaskFailed(taskId, error)
'status' (with tasks)  → setPendingTasks(tasks)  [optional, mirrors pending_tasks]
```

---

## 6. AgentPromptLoader — How It Works

**File:** `packages/core/src/storage/AgentPromptLoader.ts` (~20 lines)

### Mechanism

```typescript
class AgentPromptLoader implements IAgentPromptLoader {
  async load(agentName: string, projectPath: string): Promise<string> {
    // 1. Try: .nova/agents/{agentName}.md
    const filePath = join(projectPath, '.nova', 'agents', `${agentName}.md`);
    const content = await readFile(filePath, 'utf-8');
    if (content.trim().length > 0) return content;
    // 2. Fallback: DEFAULT_AGENT_PROMPTS[agentName]
    return DEFAULT_AGENT_PROMPTS[agentName] ?? '';
  }
}
```

### Default prompts (`packages/core/src/storage/agentPrompts.ts`)

Three built-in agents:

| Agent | Purpose | Output format |
|-------|---------|---------------|
| `developer` | Code generation | `=== FILE: path ===` for new files, `=== DIFF: path ===` for existing files |
| `tester` | Code validation | `=== VERDICT ===` with `status: PASS\|FAIL`, list of errors |
| `director` | Code review director | `=== VERDICT ===` with `decision: APPROVED\|NEEDS_REVISION\|REJECTED`, action items |

### Extension for orchestrator/worker prompts

The system is designed for extension:

1. **Add new default prompts** in `DEFAULT_AGENT_PROMPTS`:
   ```typescript
   orchestrator: `You are a mission orchestrator...`,
   worker: `You are a general-purpose worker agent...`,
   ```

2. **Create `.nova/agents/` files** at runtime (already idempotent in `NovaDir.init()`):
   - `.nova/agents/orchestrator.md`
   - `.nova/agents/worker.md`

3. **The `AgentPromptLoader.load()`** method already supports any agent name — no code changes needed. Just call:
   ```typescript
   agentPromptLoader.load('orchestrator', cwd);
   agentPromptLoader.load('worker', cwd);
   ```

4. **Lane3Executor** already uses `AgentPromptLoader` for multi-file tasks (passes it in constructor). The orchestrator can similarly receive it as a dependency.

---

## 7. Storage / NovaDir — Directory Structure

**File:** `packages/core/src/storage/NovaDir.ts` (~70 lines)

### `.nova/` directory structure

```
.nova/
├── config.toml          # Nova project configuration
├── graph.json           # Dependency graph (initially "[]")
├── context.md           # Project context (initially empty)
├── analysis.json        # Project analysis results (initially "{}")
├── embeddings.json      # Embedding records (initially "[]")
├── recipes/             # Saved recipes/templates
├── history/             # Task execution history
├── cache/               # General cache
├── agents/              # Agent prompt markdown files
│   ├── developer.md
│   ├── tester.md
│   └── director.md
├── suggestions/         # AI suggestions
└── queue/               # Task queue
```

### Initialization behavior

- `NovaDir.init()` is **idempotent** — safe to call multiple times
- Creates all subdirectories with `mkdir -p` semantics
- Only writes default files if they don't already exist (`access()` check)
- Only writes default agent prompts if the files don't already exist (preserves user customizations)
- Adds `.nova` to `.gitignore` if not already present

### Where `.nova/missions/` would fit

Add `'missions'` to the `SUBDIRS` array:

```typescript
// Current:
const SUBDIRS = ['recipes', 'history', 'cache', 'agents', 'suggestions', 'queue'] as const;

// Proposed:
const SUBDIRS = ['recipes', 'history', 'cache', 'agents', 'suggestions', 'queue', 'missions'] as const;
```

That's it — `NovaDir.init()` automatically creates it. The missions directory could store:
- `.nova/missions/{mission-id}.json` — mission definition and state
- `.nova/missions/{mission-id}/` — per-mission subdirectories with artifacts, logs, checkpoints

### Contract: `INovaDir` (`packages/core/src/contracts/IStorage.ts`)

```typescript
export interface INovaDir {
  init(projectPath: string): Promise<void>;
  exists(projectPath: string): boolean;
  clean(projectPath: string): Promise<void>;
  getPath(projectPath: string): string;
}
```

No changes needed — the interface is minimal and sufficient. Missions storage would be a separate `IMissionStore` interface.

---

## 8. Contracts — Complete Inventory

**Directory:** `packages/core/src/contracts/` (14 files + index.ts)

### Current contracts

| File | Key interfaces/exports | Lines | Relevant to missions? |
|------|----------------------|-------|----------------------|
| `IBrain.ts` | `IBrain`, `ITaskDecomposer`, `IPromptBuilder`, `ILaneClassifier`, `BrainError` | ~75 | **YES** — may need `IOrchestrator` |
| `IExecutor.ts` | `IExecutorPool`, `ILane1Executor`, `ILane2Executor`, `IDiffApplier`, `IValidator`, `DiffError` | ~100 | **YES** — will need `ILane5Executor` or `IMissionExecutor` |
| `IStorage.ts` | `INovaDir`, `IGraphStore`, `IAgentPromptLoader`, `ISearchRouter`, `IVectorStore`, `IEmbeddingService`, `IProjectAnalyzer`, `IHistoryStore`, `IRecipeStore` | ~130 | **YES** — will need `IMissionStore` |
| `ILlmClient.ts` | `LlmClient` (type), `Message`, `ChatOptions`, `ProviderError` | ~60 | Maybe — orchestrator may need different LLM config |
| `IEventBus.ts` | `EventBus` | ~12 | No — already sufficient |
| `IGitManager.ts` | `IGitManager`, `GitError` | ~80 | No — already sufficient |
| `IProxy.ts` | `IProxyServer`, `IWebSocketServer`, `IDevServerRunner`, `InvalidCommandError` | ~130 | No — WS already extensible |
| `IConfigReader.ts` | `IConfigReader` | ~40 | Maybe — may need mission config |
| `IIndexer.ts` | `IIndexer` | ~100 | No |
| `ILicense.ts` | `ILicenseChecker` | ~40 | No |
| `IManifestStore.ts` | `IManifestStore` | ~30 | No |
| `IPathGuard.ts` | `IPathGuard` | ~25 | No — already sufficient |
| `ITeamDetector.ts` | `ITeamDetector` | ~5 | No |
| `ILogger.ts` | `ILogger` | ~15 | No |
| `index.ts` | Re-exports all above | ~14 | **YES** — add new exports |

### Contracts that need extension for Lane 5 / Missions

#### 1. **`IExecutor.ts`** — Add `ILane5Executor`

```typescript
export interface ILane5Executor {
  /**
   * Executes a multi-agent mission via orchestrator-worker pattern.
   * 
   * Process:
   * 1. Creates mission plan (orchestrator)
   * 2. Dispatches subtasks to worker agents
   * 3. Validates results via tester
   * 4. Reviews via director
   * 5. Iterates up to 5 times until approved
   * 
   * @returns ExecutionResult with aggregated diff and commit hash
   */
  execute(mission: MissionItem, projectMap: ProjectMap): Promise<ExecutionResult>;
}
```

Also update `IExecutorPool.execute()` switch to handle lane 5.

#### 2. **`IBrain.ts`** — Add `IOrchestrator`

```typescript
export interface IOrchestrator {
  /**
   * Plans a multi-step mission from an observation.
   * Returns a mission plan with ordered steps and worker assignments.
   */
  plan(observation: Observation, projectMap: ProjectMap): Promise<MissionPlan>;

  /**
   * Coordinates execution of a mission step with worker agents.
   * Implements developer → tester → director loop.
   */
  executeStep(step: MissionStep, projectMap: ProjectMap): Promise<StepResult>;
}
```

#### 3. **`IStorage.ts`** — Add `IMissionStore`

```typescript
export interface IMissionStore {
  save(mission: MissionRecord): Promise<void>;
  load(missionId: string): Promise<MissionRecord | null>;
  getAll(): Promise<MissionRecord[]>;
  getActive(): Promise<MissionRecord[]>;
  updateStatus(missionId: string, status: MissionStatus): Promise<void>;
  appendStepResult(missionId: string, result: StepResult): Promise<void>;
  remove(missionId: string): Promise<void>;
}
```

#### 4. **`models/types.ts`** — Extend `Lane` type and add mission types

```typescript
// Current:
export type Lane = 1 | 2 | 3 | 4;

// Proposed:
export type Lane = 1 | 2 | 3 | 4 | 5;

// New types needed:
export interface MissionItem {
  id: string;
  description: string;
  plan: MissionStep[];
  status: MissionStatus;
  lane: 5;
  // ...
}

export interface MissionStep {
  id: string;
  description: string;
  files: string[];
  type: TaskType;
  assignedWorker: 'developer' | 'tester' | 'director';
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: StepResult;
}

export type MissionStatus = 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
```

#### 5. **`contracts/index.ts`** — Add new exports

```typescript
export * from './IMissionStore.js';   // new
export * from './IOrchestrator.js';   // new (or in IBrain.js)
```

---

## Summary of Key Architectural Insights

### Event flow architecture
```
Overlay WS → EventRouter → EventBus → Brain.analyze() → TaskItem[]
    → confirmation gate → ExecutorPool.execute() → Lane1/2/3/4
    → EventBus events → EventRouter → Overlay WS → TaskPanel UI
```

### Lane system (current)
- **Lane 1**: CSS/text regex changes, no LLM (fastest)
- **Lane 2**: Single-file diff-based, single LLM call
- **Lane 3**: Multi-file changes, decomposed into subtasks
- **Lane 4**: Background refactoring/migration

### Where Lane 5 / missions would plug in
1. **`start.ts` step 15**: Add `MissionExecutor` (Lane 5) to `ExecutorPool` constructor
2. **`ExecutorPool.execute()`**: Add `case 5:` branch routing to the new executor
3. **`EventRouter`**: No changes needed — already forwards all task events generically
4. **`Brain`**: Supplemented by an `Orchestrator` that wraps Brain for multi-step planning
5. **`TaskPanel`**: Already handles `pending/executing/completed/failed` states — no UI changes needed (though streaming could show per-subtask progress)
6. **`AgentPromptLoader`**: Add `orchestrator` and `worker` prompt defaults
7. **`NovaDir`**: Add `'missions'` to SUBDIRS for `.nova/missions/`
8. **Contracts**: Add `IOrchestrator`, `ILane5Executor`, `IMissionStore`; extend `Lane` type from `1|2|3|4` to `1|2|3|4|5`
