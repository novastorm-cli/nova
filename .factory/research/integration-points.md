# Nova Codebase: Integration Points for Lane 5 (Mission Executor)

> Generated: 2026-05-21  
> Source: `/home/upranevich/Projects/Open_source/nova`

---

## 1. IExecutor Interface (`packages/core/src/contracts/IExecutor.ts`)

The file defines the top-level `IExecutorPool` interface and per-lane executor contracts:

### `IExecutorPool`
```ts
export interface IExecutorPool {
  execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult>;
}
```
This is the single entry point. The pool's `execute()` routes to the correct lane based on `task.lane`, emits `task_started`, `task_completed`, `task_failed` events, and manages FSM state transitions.

### Existing Lane Interfaces
- **`ILane1Executor`** — Regex/AST instant changes (CSS/text/visibility). No LLM.
- **`ILane2Executor`** — Single-file diff via one LLM call.
- **`IDiffApplier`** — Applies/generates unified diffs.
- **`IValidator`** — Runs tsc, ESLint, build checks.

**For Lane 5:** A new `ILane5Executor` interface is needed. It should extend the same pattern: `execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult>`. The key difference: Lane 5 tasks are multi-step *missions* that involve planning, orchestrating subtasks across lanes 1-3, and iterative refinement with a "director" review loop. The interface shape is the same — the internal implementation is what differs.

### Key types used:
- **`TaskItem`** — id, description, files, type (css|single_file|multi_file|refactor), lane (1-4 currently), status, commitHash, diff, error, preConfirmed, domSnapshot
- **`ProjectMap`** — stack info, dev command, port, routes, components, endpoints, models, dependency graph, file contexts, compressed context
- **`ExecutionResult`** — success, taskId, diff?, commitHash?, error?

---

## 2. ExecutorPool (`packages/core/src/executor/ExecutorPool.ts`)

### How it dispatches

The `ExecutorPool` constructor creates the lane executors and stores them as private fields. The `execute()` method uses a `switch (task.lane)` to route:

```ts
switch (task.lane) {
  case 1: // regex/AST, fallback to lane3Micro on failure
  case 2: // diff-based, fallback to lane3Standard on failure
  case 3: // multi-file via lane3Strong
  case 4: // background via Lane4Executor, fallback to lane3Strong
  default: // exhaustive check, returns error
}
```

Each lane case:
1. Calls the lane executor
2. Has fallback logic (Lane 1→micro model, Lane 2→standard model)
3. Emits events on success/failure
4. Manages FSM transitions via `ExecutorFSM`

### FSM States
The `ExecutorFSM` manages per-task state: `Planning → Generating → Applying → Validating → Committing` or `Failed`. Transitions emit `fsm_transition` events.

### How to add Lane 5

1. **Add `lane: 5`** to the `Lane` union type in `models/types.ts`:
   ```ts
   export type Lane = 1 | 2 | 3 | 4 | 5;
   ```

2. **Create `Lane5Executor`** class implementing the same pattern as `Lane3Executor` but with multi-turn orchestration logic.

3. **Add `case 5`** to the switch in `ExecutorPool.execute()`:
   ```ts
   case 5: {
     if (!this.lane5) {
       result = { success: false, taskId: task.id, error: 'Lane 5 requires LLM + Git' };
       break;
     }
     result = await this.lane5.execute(task, projectMap);
     break;
   }
   ```
   The `default` case already handles unknown lanes gracefully via the exhaustive `never` check — adding `case 5` will make it compile.

4. **Add Lane 5 constructor params** to `ExecutorPool`. Lane 5 likely needs: `llmClient`, `gitManager`, `eventBus`, `projectPath`, the strong model name, `agentPromptLoader`, `pathGuard`, `commitQueue`, and potentially a separate "orchestrator" model.

5. **Add Lane 5 to `start.ts`** where `ExecutorPool` is constructed.

### RetryPolicy
The `RetryPolicy` (max 3 retries, exponential backoff 1s/2s/4s) is shared across all lanes. Lane 5 can reuse it.

---

## 3. LaneClassifier (`packages/core/src/brain/LaneClassifier.ts`)

### Classification Rules (in priority order)

| Priority | Rule | Result |
|----------|------|--------|
| Highest | Matches `LANE4_PATTERN`: `refactor\|migrate\|rewrite\|redesign\|restructure\|upgrade` | Lane 4 |
| High | Matches `LANE3_PATTERN`: `add.*page\|new.*endpoint\|create.*component` | Lane 3 |
| Medium | Style/text keywords (color, font, margin, etc.) + single file, NOT new element | Lane 1 |
| Medium | Style keywords + multiple files | Lane 2 |
| Low | Multiple files affected (non-style) | Lane 3 |
| Default | Single file | Lane 2 |

### Keywords to trigger Lane 5
The classification is pure rule-based (no LLM, <1ms). New Lane 5 keywords could include:
- **Mission patterns**: `mission`, `feature`, `implement`, `build`, `add.*feature`, `create.*feature`
- **Multi-phase patterns**: `plan and`, `design and implement`, `research then build`, `full stack`, `end-to-end`
- **Scope patterns**: Crosses frontend + backend boundaries

A new `LANE5_PATTERN` regex should be added **between** Lane 4 and Lane 3 in priority:
```ts
const LANE5_PATTERN = /\b(mission|feature request|implement\s+feature|full-stack|build\s+.*feature)\b/i;
```

The method signature `classify(taskDescription: string, affectedFiles: string[]): 1 | 2 | 3 | 4` needs to become `1 | 2 | 3 | 4 | 5`.

---

## 4. LLM Provider System (`packages/core/src/llm/`)

### Architecture

```
ILlmClient (contract)
  └── BaseProvider (abstract)
        ├── AnthropicProvider
        ├── OpenAIProvider
        ├── OpenRouterProvider
        ├── OllamaProvider
        ├── ClaudeCliProvider
        └── DeepSeekProvider

ProviderFactory.create(provider: string, apiKey?: string): LlmClient
```

### How providers are initialized

In `start.ts`, a single `LlmClient` instance is created:
```ts
const llmClient = providerFactory.create(config.apiKeys.provider, config.apiKeys.key);
```
This single client is shared by all lanes. The model name is varied per lane via the `model` option in `LlmOptions`:
```ts
{ model: config.models.micro }   // Lane 1 fallback
{ model: config.models.standard } // Lane 2 fallback
{ model: config.models.strong }   // Lane 3, Lane 4
```

### How to get separate "orchestrator" vs "worker" model

**Option A: Two LlmClient instances with different models**
The simplest approach. Create a second `LlmClient` with a different default model. In `ExecutorPool` constructor, accept a second `llmClient` for Lane 5's orchestrator role:
```ts
constructor(
  // ... existing params
  private readonly lane5OrchestratorLlm?: LlmClient,  // strong model for planning
  // workerLlm is the existing llmClient parameter
)
```

**Option B: Single client, override model per call**
Already supported via `options.model` in `LlmOptions`. Lane 5 can use the same `LlmClient` but pass different model names for planning vs. code generation:
```ts
await llmClient.chat(messages, { model: 'claude-opus-4-6' });  // orchestrator
await llmClient.chat(messages, { model: 'claude-sonnet-4-6' }); // worker
```

**Option C: Add `[models] orchestrator` to `NovaConfig`**
Add a fourth model tier to the config:
```toml
[models]
micro = "deepseek-v4-flash"
standard = "deepseek-v4-pro"
strong = "deepseek-v4-pro"
orchestrator = "claude-opus-4-6"  # new
```

**Recommendation:** Option C (config-driven) for user flexibility, with Option B as the implementation mechanism (pass model name via LlmOptions). The `BaseProvider` already supports `fallbackModel` for automatic fallback on retry exhaustion.

### Key LLM features available to Lane 5:
- **`streamWithEvents()`** in `llm/streamWithEvents.ts` — streams LLM output with per-chunk event emission (`llm_chunk` events with `phase: 'reasoning' | 'code'`)
- **`executeWithRetry()` / `streamWithRetry()`** — built-in retry with exponential backoff
- **`BaseProvider.fallbackModel`** — automatic fallback on all-retries-exhausted
- **`chatWithVision()`** — multimodal (screenshot + text) for vision-capable providers

---

## 5. EventBus and Events (`packages/core/src/events/`)

### EventBus Implementation

`NovaEventBus` wraps Node.js `EventEmitter`:
```ts
export class NovaEventBus implements EventBus {
  emit(event: NovaEvent): void;
  on<T>(type: T, handler: (event: Extract<NovaEvent, { type: T }>) => void): void;
  off<T>(type: T, handler: (event: Extract<NovaEvent, { type: T }>) => void): void;
}
```

### Complete List of Event Types

From `models/events.ts`:

| Event Type | Emitted By | Purpose |
|------------|-----------|---------|
| `observation` | WebSocket → EventBus | User observation (screenshot + voice) |
| `task_created` | EventRouter | New task added to queue |
| `task_started` | ExecutorPool | Task execution begins |
| `task_completed` | ExecutorPool | Task finished successfully |
| `task_failed` | ExecutorPool | Task failed |
| `file_changed` | File watcher | File modified on disk |
| `index_updated` | Indexer | Project re-indexed |
| `status` | Various | Status message for overlay toast |
| `confirm` | Overlay → Server | User confirmed pending tasks |
| `cancel` | Overlay → Server | User cancelled pending tasks |
| `llm_chunk` | streamWithEvents | Streaming LLM output chunk |
| `secrets_required` | EnvDetector | Missing env vars detected |
| `analysis_complete` | ProjectAnalyzer | Structure analysis done |
| `passive_behavior` | Passive tracker | User behavior event |
| `passive_pattern` | Pattern detector | Recurring behavior pattern |
| `passive_suggestion` | Suggestion engine | Auto-generated suggestion |
| `suggestion_response` | User | User approved/rejected suggestion |
| `background_queued` | Lane4Executor | Task added to background queue |
| `background_started` | Lane4Executor | Background task started |
| `background_progress` | Lane4Executor | Background task progress |
| `background_completed` | Lane4Executor | Background task completed |
| `background_failed` | Lane4Executor | Background task failed |
| `pending_tasks` | EventRouter → Overlay | Tasks awaiting confirmation |
| `confirm_tasks` | Overlay → Server | Confirm specific task IDs |
| `fsm_transition` | ExecutorFSM | FSM state change |
| `provider_retry` | BaseProvider | LLM retry attempt |
| `provider_fallback` | BaseProvider | LLM fallback triggered |

### What Lane 3 Emits (via Lane3Executor)
- `task_started` / `task_completed` / `task_failed` (via ExecutorPool wrapper)
- `status` — progress messages ("Generating code...", "Validating...", "Fixing errors...")
- `llm_chunk` — via `streamWithEvents()` for streaming feedback
- `secrets_required` — when generated code references missing env vars
- `fsm_transition` — via ExecutorFSM

### New Events Lane 5 Would Need

| Event | Purpose |
|-------|---------|
| `mission_planned` | Emitted when the orchestrator finishes its plan. Data: `{ taskId, plan: MissionPlan }` |
| `mission_subtask_started` | Emitted when a subtask begins execution. Data: `{ taskId, subtaskId, description }` |
| `mission_subtask_completed` | Emitted when a subtask finishes. Data: `{ taskId, subtaskId, result }` |
| `mission_director_review` | Emitted when the director reviews output. Data: `{ taskId, verdict: 'APPROVED'\|'NEEDS_REVISION'\|'REJECTED' }` |
| `mission_iteration` | Current iteration count (max 5 per CLAUDE.md). Data: `{ taskId, iteration, maxIterations }` |
| `mission_completed` | Entire mission done. Data: `{ taskId, commitHash, diff, subtaskCount }` |
| `mission_failed` | Mission failed (director rejected or max iterations reached). Data: `{ taskId, error }` |

These follow the existing event naming convention: `{domain}_{action}`.

---

## 6. Overlay Communication (`packages/overlay/src/`)

### Architecture

The overlay runs inside the browser (injected via proxy `<script>` tag). It communicates with the server through a **WebSocket** at `ws://localhost:{port}/nova-ws`.

### WebSocketClient (`transport/WebSocketClient.ts`)
- Connects to `ws://localhost:{port}/nova-ws?token={sessionToken}`
- Sends: `send(observation)` and `sendRaw(message)` for typed messages
- Receives: `onEvent(callback)` for all server→overlay events

### Message types FROM overlay TO server (via `sendRaw`)
Defined in `WebSocketServer.ts` handler:

| Type | Data | Purpose |
|------|------|---------|
| `observation` | BrowserObservation (screenshot, transcript, dom, url, etc.) | User's voice/click action |
| `confirm` | — | User confirms pending tasks |
| `confirm_tasks` | `{ taskIds: string[] }` | Confirm specific tasks |
| `cancel` | — | User rejects pending tasks |
| `append` | `{ text: string }` | Append text to current request |
| `browser_error` | `{ error: string }` | Console error for autofix |
| `secrets_submit` | `{ secrets: Record<string, string> }` | User-provided env vars |
| `revert_file` | `{ path: string }` | Revert a file change |

### Message types FROM server TO overlay (via `WebSocketServer.sendEvent()`)

All `NovaEvent` types are forwarded to the overlay. The overlay's `wsClient.onEvent()` handler processes:

| Event Type | Overlay Action |
|------------|----------------|
| `task_started` | Adds to task panel + activity log |
| `task_completed` | Updates task panel, shows success toast, triggers page reload |
| `task_failed` | Shows error in task panel and activity log |
| `task_created` | Adds task to panel, tracks source (quick-edit/multi-edit) |
| `llm_chunk` | Shows phase status in task panel; accumulates FILE/DIFF blocks in activity log |
| `status` | Shows toast messages; handles special keywords: `autofix_start/end/failed`, `question:`, `Pending:`, `Confirmed!` |
| `pending_tasks` | Shows confirmation dialog with task list |
| `secrets_required` | Opens secret console for missing env vars |
| `analysis_complete` | Shows project analysis summary |
| `background_*` | (Not explicitly handled in overlay — routed through event bus) |

### What Lane 5 needs in the overlay
- The overlay already has `TaskPanel` which can display task lists. Lane 5 missions could reuse it for showing subtask progress.
- New `mission_*` events would need corresponding `case` blocks in the `wsClient.onEvent()` handler within `index.ts`.
- The `ActivityLog` component already supports diff entries — Lane 5 code output would flow through the same `llm_chunk` → `=== FILE/DIFF: ===` parsing.

---

## 7. TaskItem and Related Types (`packages/core/src/models/types.ts`)

```ts
export type TaskType = 'css' | 'single_file' | 'multi_file' | 'refactor';
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'rolled_back';
export type Lane = 1 | 2 | 3 | 4;  // ← needs 5 added

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
  preConfirmed?: boolean | undefined;
  domSnapshot?: string | undefined;
}
```

### Fields Lane 5 would add or use differently:
- **`type`**: New value `'mission'` would indicate a multi-phase mission task.
- **`files`**: Lane 5 may not have specific target files initially — the orchestrator determines them during planning.
- **`lane: 5`**: The field discriminator.
- **New field: `missionPlan?: MissionPlan`** — stores the orchestrator's plan (subtasks, dependencies, stages).
- **New field: `parentTaskId?: string`** — for linking subtasks back to the mission.
- **New field: `iteration?: number`** — tracks the current director review iteration.
- **`preConfirmed`**: Already works for auto-execute. Lane 5 missions could inherit this.

### `MissionPlan` type (new):
```ts
export interface MissionPlan {
  stages: MissionStage[];
  subtasks: SubtaskItem[];
}

export interface MissionStage {
  name: string;           // e.g. "Phase 1: Data Models", "Phase 2: API"
  order: number;
  subtaskIds: string[];   // IDs of subtasks in this stage
}

export interface SubtaskItem {
  id: string;
  description: string;
  files: string[];
  type: TaskType;
  lane: 1 | 2 | 3;        // Subtasks use existing lanes
  dependencies: string[];  // Subtask IDs that must complete first
  status: TaskStatus;
}
```

---

## 8. Config System (`packages/cli/src/config.ts` + `packages/core/src/models/config.ts`)

### nova.toml structure
```toml
[project]
devCommand = "npm run dev"
port = 3000
frontend = "src"        # optional
backends = ["api"]      # optional

[models]
micro = "claude-haiku-4-5-20251001"
standard = "claude-sonnet-4-6"
strong = "claude-opus-4-6"
local = false

[apiKeys]
provider = "openrouter"  # openrouter|anthropic|openai|ollama|claude-cli|deepseek
key = "sk-..."           # optional, resolved from env

[behavior]
autoCommit = false
confirmTasks = true
branchPrefix = "nova/"
passiveSuggestions = true

[voice]
enabled = true
engine = "web"           # web|whisper

[telemetry]
enabled = true

[license]
key = "..."

[git]
allowProtectedBranchCommits = false

[rag]
embeddingProvider = "openai"  # openai|ollama|tfidf
```

### Config types (`NovaConfig`):
```ts
export interface NovaConfig {
  project: { devCommand: string; port: number; frontend?: string; backends?: string[] };
  models: { micro: string; standard: string; strong: string; local: boolean };
  apiKeys: { provider: ProviderType; key?: string };
  behavior: { autoCommit: boolean; confirmTasks: boolean; branchPrefix: string; passiveSuggestions: boolean };
  voice: { enabled: boolean; engine: 'web' | 'whisper' };
  telemetry: { enabled: boolean };
  license?: { key?: string };
  git?: { allowProtectedBranchCommits?: boolean };
  rag?: { embeddingProvider?: 'openai' | 'ollama' | 'tfidf' };
}
```

### Where to add mission config

Two options:

**Option A: Add to `[models]` section**
```toml
[models]
micro = "deepseek-v4-flash"
standard = "deepseek-v4-pro"
strong = "deepseek-v4-pro"
orchestrator = "claude-opus-4-6"  # Used for Lane 5 planning
```

**Option B: New `[mission]` section**
```toml
[mission]
enabled = true
orchestratorModel = "claude-opus-4-6"
maxIterations = 5
autoApprove = false
```

**Recommendation:** Both. Add `orchestrator` to `models` (reuse existing pattern) and create a `[mission]` section for mission-specific behavior flags. The config reader's `KNOWN_SECTIONS` array would need `'mission'` added to avoid the "unrecognized section" warning.

The `ConfigReader.read()` merges `DEFAULT_CONFIG ← project nova.toml ← .nova/config.toml`, then applies env var overrides and provider-specific model defaults. `PROVIDER_MODEL_DEFAULTS` should include an `orchestrator` default for each provider.

---

## 9. CommitQueue (`packages/core/src/git/CommitQueue.ts`)

### How it works

The `CommitQueue` **serializes git commits** to prevent race conditions when multiple lane executors run in parallel. It's needed because Node.js `fs` operations from different lanes can complete out of order, but git commits must be sequential.

```ts
export class CommitQueue {
  private queue: Promise<string> = Promise.resolve('');

  enqueue(message: string, files: string[], taskId?: string): Promise<string>;
}
```

Each `enqueue()` call chains onto the previous promise:
```ts
this.queue = this.queue.then(
  () => this.guardedCommit(message, files),   // on success
  (err) => { /* log error, emit task_failed */ return this.guardedCommit(message, files); }
);
```

This ensures exactly one commit runs at a time. The queue also:
- Checks branch protection (refuses commits to `main`/`master`/`develop` unless `allowProtectedBranchCommits` is set)
- Creates nova-specific branches (`nova/<task-id>`)
- Emits `task_failed` events if a previous commit failed

### Can Lane 5 reuse it?

**Yes.** The `CommitQueue` is already shared across lanes. In `ExecutorPool`, a single `CommitQueue` instance is created and passed to both `Lane3Executor` (micro/standard/strong) and `Lane2Executor`:

```ts
const sharedQueue = commitQueue ?? (gitManager ? new CommitQueue(gitManager) : undefined);
this.lane3Micro = new Lane3Executor(..., sharedQueue);
this.lane3Standard = new Lane3Executor(..., sharedQueue);
this.lane2Receiver = new Lane2Executor(..., sharedQueue);
```

Lane 5 should receive this same shared `CommitQueue` instance. When the orchestrator dispatches subtasks to lanes 1-3, those lanes already use the shared queue, so commits remain serialized.

**One consideration:** Lane 5 might want to batch subtask commits into a single mission commit. This would require:
1. A flag to defer commits during subtask execution
2. A final `commitQueue.enqueue()` call with all changed files
3. Or, use the existing per-subtask commits (simpler, already works)

---

## Summary: Files That Need Changes for Lane 5

| File | Change |
|------|--------|
| `packages/core/src/models/types.ts` | Add `5` to `Lane` union, add `MissionPlan`/`SubtaskItem` types, add `'mission'` to `TaskType` |
| `packages/core/src/models/events.ts` | Add `mission_planned`, `mission_subtask_*`, `mission_director_review`, `mission_iteration`, `mission_completed`, `mission_failed` event types |
| `packages/core/src/models/eventSchemas.ts` | Add Zod schemas for new event types |
| `packages/core/src/models/config.ts` | Add `orchestrator` to `models`, add optional `[mission]` section to `NovaConfig` |
| `packages/core/src/contracts/IExecutor.ts` | Add `ILane5Executor` interface (optional — can use same pattern as Lane 3) |
| `packages/core/src/contracts/IBrain.ts` | Update `ILaneClassifier.classify()` return type to `1 \| 2 \| 3 \| 4 \| 5` |
| `packages/core/src/brain/LaneClassifier.ts` | Add `LANE5_PATTERN`, update return type, add classification rule |
| `packages/core/src/executor/ExecutorPool.ts` | Add `case 5` to switch, add Lane 5 constructor params |
| `packages/core/src/executor/Lane5Executor.ts` | **NEW FILE** — main mission executor with planning, orchestration, director review loop |
| `packages/core/src/executor/MissionPlanner.ts` | **NEW FILE** — orchestrator LLM call to produce `MissionPlan` |
| `packages/core/src/executor/MissionDirector.ts` | **NEW FILE** — review loop (validates subtask output, decides approve/revise/reject) |
| `packages/cli/src/commands/start.ts` | Pass orchestrator model + mission config to ExecutorPool, instantiate Lane5Executor |
| `packages/cli/src/config.ts` | Add `'mission'` to `KNOWN_SECTIONS` (to avoid unrecognized section warning) |
| `packages/overlay/src/index.ts` | Handle new `mission_*` events in `wsClient.onEvent()` |
| `packages/cli/src/boot/EventRouter.ts` | Forward new `mission_*` events to overlay |

## Key Design Decisions for Lane 5

1. **Lane 5 is an orchestrator, not a replace-for-lanes-1-3.** It uses the existing lane executors (1-3) for individual file changes, adding a planning layer on top. This follows the "developer → tester → director" loop from `CLAUDE.md`.

2. **Model separation:** The orchestrator needs a strong reasoning model (e.g., Opus/GPT-4-level) for planning, while subtask execution can use the existing per-lane models (micro/standard/strong). Add a configurable `orchestrator` model tier.

3. **Reuse CommitQueue, EventBus, PathGuard, GitManager** — all are already shared across lanes. No changes needed to these core services.

4. **Overlay updates are minimal** — the existing `TaskPanel` and `ActivityLog` components can display subtask progress with the new events. The overlay already handles `llm_chunk` streaming for real-time feedback.

5. **Max 5 iterations** (per `CLAUDE.md` guidelines) — the director loop should enforce this cap.
