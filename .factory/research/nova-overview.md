# Nova (Novastorm) — Project Overview

> Thorough analysis of the Nova project structure, architecture, and key components.
> Generated on 2026-05-21 from source code at `/home/upranevich/Projects/Open_source/nova`.

---

## 1. What is Nova?

**Novastorm** (published as `@novastorm-ai/cli` on npm, package name `nova-architect` in the monorepo root) is an **"Ambient Development Toolkit"** — an AI-powered CLI tool that observes how you use your web application and builds full-stack features based on your behavior, voice commands, and visual cues.

### Key Characteristics

- **CLI-first**: Installed via `npm install -g @novastorm-ai/cli`, run with `nova` in any project directory.
- **Stack-agnostic**: Auto-detects Next.js, React, Vue, Svelte, Astro, Express, Django, FastAPI, .NET, Rails, Go, or any combination.
- **AI-powered code generation**: Uses LLMs (Anthropic Claude, OpenAI GPT, Ollama local, OpenRouter, DeepSeek) to generate code changes.
- **Browser overlay**: Injects a thin overlay (~20KB) into the dev server's pages for visual selection, voice commands, and gesture-based interaction.
- **Proxy architecture**: An HTTP/WebSocket proxy sits between the dev server and browser, injecting the overlay and routing communication.
- **Speed lanes**: Tasks classified into 4 lanes based on complexity:
  - **Lane 1 (Instant, <2s)**: CSS tweaks, text changes, spacing — regex/AST-based, no LLM.
  - **Lane 2 (Fast, 10-30s)**: Single-file changes, new component — single LLM call producing a diff.
  - **Lane 3 (Thorough, 1-5 min)**: Multi-file features, new pages + API + DB — LLM with validation/fix loop.
  - **Lane 4 (Background, minutes-hours)**: Refactoring, migrations, optimization — background queue.

### Licensing
- Source-available under **Business Source License 1.1**.
- Free for individuals, teams ≤3, open-source, students, evaluation.
- Paid license required for teams of 4+ on closed-source projects.
- Converts to MIT on March 20, 2029.

---

## 2. Project Structure — Monorepo

The project is a **pnpm workspace** monorepo with 5 packages under `packages/`:

### Packages

| Package | npm Name | Purpose |
|---------|----------|---------|
| `packages/cli` | `@novastorm-ai/cli` | **Command-line interface** — the `nova` binary, all commands (`start`, `setup`, `doctor`, etc.), terminal chat REPL, autofix watcher, configuration reader, boot orchestration. |
| `packages/core` | `@novastorm-ai/core` | **Core engine** — Brain (AI analysis), project indexing (stack detection, route/component extraction, dependency graph), speed-lane executors (Lanes 1-4), code validation (tsc, import checks), code fixing (LLM-based error correction), git management, RAG indexing, LLM providers, event bus, logging, passive suggestions engine. |
| `packages/overlay` | `@novastorm-ai/overlay` | **Browser overlay** — Injected into the user's app pages. Provides the floating "pill" UI (microphone, status), transcript bar, element inspector, multi-selector, task panel, voice capture, gesture recognition, cursor tracking, console error capture. Built as an IIFE for injection. |
| `packages/proxy` | `@novastorm-ai/proxy` | **HTTP/WebSocket proxy** — Sits between the dev server and browser. Injects the overlay script into HTML pages, proxies all requests, manages WebSocket connections for real-time communication between overlay and CLI/core. |
| `packages/licensing` | `@novastorm-ai/licensing` | **License validation** — Checks license validity, counts developers, handles telemetry for license compliance. |

### Dependency Graph

```
cli ──depends on──▶ core
cli ──depends on──▶ proxy
cli ──depends on──▶ licensing
proxy ──depends on──▶ core
overlay ──depends on──▶ core
licensing ──depends on──▶ core
```

### Core Package Internal Structure

```
packages/core/src/
├── brain/          — Brain (AI task decomposition from observations)
├── contracts/      — TypeScript interfaces (ILlmClient, IGitManager, IPathGuard, etc.)
├── events/         — NovaEventBus implementation
├── executor/       — Speed-lane executors (Lanes 1-4), CodeValidator, CodeFixer, DiffApplier, EnvDetector
├── git/            — GitManager, CommitQueue
├── indexer/        — ProjectIndexer, StackDetector, route/component/endpoint extractors
├── llm/            — LLM provider factory, streamWithEvents helper
├── logging/        — StructuredLogger
├── models/         — Type definitions (TaskItem, ProjectMap, Observation, etc.)
├── passive/        — Passive suggestion engine (behavior patterns, suggestions)
├── security/       — PathGuard (prevents path traversal)
└── storage/        — NovaDir, ManifestStore, AgentPromptLoader, GraphStore
```

### CLI Package Internal Structure

```
packages/cli/src/
├── autofix.ts      — ErrorAutoFixer (automatic compilation error detection and fixing)
├── boot/           — Startup orchestration (PortManager, EventRouter, BrowserOpener, etc.)
├── commands/       — CLI commands (start.ts, setup.ts, doctor.ts, etc.)
├── chat.ts         — Terminal chat REPL
├── config.ts       — ConfigReader for nova.toml
├── index.ts        — Main entry point, CLI option definitions
├── scaffold.ts     — Project scaffolding (generating initial files for empty projects)
├── setup.ts        — Interactive setup wizard
└── telemetry.ts    — Telemetry
```

---

## 3. The "Autofix" Feature — `packages/cli/src/autofix.ts`

### Purpose
The `ErrorAutoFixer` is a **dev-server output watcher** that automatically detects compilation/build errors in the developer's running dev server and attempts to fix them using AI.

### How it works end-to-end

#### 1. Error Detection
The autofixer subscribes to dev server stdout/stderr via `devServer.onOutput()`. Every output chunk is checked against two sets of regex patterns:
- **ERROR_PATTERNS**: Module not found, SyntaxError, TypeError, Build/Compilation errors
- **IMAGE_PATTERNS**: Next.js image errors, missing image files, ENOENT for images, unsplash/picsum references

#### 2. Debouncing & Deduplication
- Errors are buffered (streamed in chunks) with a **1-second debounce**.
- If the same error signature persists across attempts, the autofixer stops after **3 attempts** with a 1-minute cooldown.
- `isFixing` flag prevents concurrent fix attempts.

#### 3. Task Building
The `attemptAutoFix()` method constructs a task description from the error output, including:
- Truncated error text (first 500 chars)
- **Deletion intent detection**: If error keywords like "conflicting", "duplicate route", "both match" appear, the prompt explicitly instructs the LLM to **delete** files rather than create new ones.
- **Retry context**: On subsequent attempts, previous failure reasons are appended to guide the LLM toward a different approach.

#### 4. Execution Strategy
- **Image errors** → Always uses **Lane 3** (multi-file executor) with `skipValidation: true` (auto-fix skips tsc).
- **Compilation errors**:
  1. Try to **extract a file path** from the error output (Turbopack/Next.js patterns like `⨯ ./app/page.tsx:2:1`).
  2. If a known file is found in the project map → Use **Lane 2** (single-file diff executor).
  3. If no file found or the file isn't in the project map → Use **Lane 3** (multi-file executor).
  4. **Next.js route conflicts** ("App Router and Pages Router both match path: /X") → Special handling that identifies conflicting files and instructs the LLM to delete one.

#### 5. Retry Loop
On failure, the autofixer:
- Clears `.next/cache` to avoid stale Turbopack errors.
- Rebuilds the task with failure context.
- Retries up to `MAX_FIX_ATTEMPTS` (3) times.
- After all attempts exhausted, emits `autofix_budget_exhausted` status.

#### 6. Events & Status
Throughout the process, the autofixer emits status events via WebSocket and the event bus:
- `autofix_start` → fix attempt begins
- `autofix_end` → fix succeeded
- `autofix_retry_N` → retrying
- `autofix_failed` / `autofix_budget_exhausted` → all attempts failed

#### 7. Special methods
- `forceFixNow()`: Bypasses debounce, cooldown, and dedup. Used for startup health checks and post-task health checks.
- `isAutofixTask(taskId)`: Checks if a task was created by the autofixer (to avoid recursive health checks).

---

## 4. The Lane 3 Executor — `packages/core/src/executor/Lane3Executor.ts`

### Purpose
Lane 3 is the **multi-file, thorough execution lane**. It uses an LLM to generate code for complex tasks (new features, multi-file changes, pages + API + DB), then validates and iteratively fixes the generated code.

### How it works

#### Developer Phase
1. **Prompt Construction** (`buildPrompt()`):
   - Project stack info (framework + language)
   - Task description
   - Target files (if specified)
   - Full list of existing files in the project
   - Contents of key files (with line numbers for existing files, as full content for new files)
   - Available npm packages from `package.json`

2. **System Prompt**: A strict, minimal prompt that instructs the LLM to output ONLY code blocks:
   - `=== FILE: path/to/file.tsx ===` ... `=== END FILE ===` — for new files or full replacements
   - `=== DIFF: path/to/file.tsx ===` ... `=== END DIFF ===` — for unified diffs on existing files
   - `=== DELETE: path/to/file.tsx ===` — for deleting conflicting files

3. **LLM Streaming**: Uses `streamWithEvents()` to call the LLM and emit `llm_chunk` events as code streams in (so the overlay can show progress).

4. **Block Parsing** (`parseMixedBlocks()`): Parses the LLM response into:
   - **File blocks** (full content → write to disk)
   - **Diff blocks** (unified diff → apply to existing file)
   - **Delete blocks** (remove the file)

5. **Block Application** (`applyMixedBlocks()`):
   - Full files: Write directly to disk (creating directories as needed).
   - Diffs: Apply via `DiffApplier` (LCS-based diff application with context validation).
   - Failed diff applications → retry by requesting full file content from the LLM.

#### Tester/Director Loop (Validation)
After code is generated, a **validation loop** runs up to `maxFixIterations` (default 3) times:

1. **Syntax Check**: Quick bracket-balancing check on generated JS/TS files. If unbalanced, the executor re-requests the full file from the LLM.

2. **TSC Skip Optimization** (`shouldSkipTsc()`): Intelligently skips TypeScript compilation when:
   - All changes are CSS-only
   - All changes are non-TS files (JSON, MD, HTML, etc.)
   - Only a single small TS file (<5000 chars) was changed

3. **Validation** (`CodeValidator.validateFiles()`):
   - Runs `tsc --noEmit` (unless skipped) and filters errors to only generated files.
   - Checks import resolution (are imported packages in `package.json`?).
   - Checks relative imports.

4. **Fixing** (`CodeFixer.fixErrors()`): If errors are found:
   - Sends all files with errors + error details to an LLM.
   - LLM returns corrected full file content.
   - Fixed files are written back to disk.
   - Loop continues to next iteration.

#### Final Steps
- **Env var detection**: Scans generated code for `process.env.VAR_NAME` patterns and emits `secrets_required` events if vars are missing.
- **Commit**: All changes committed via `CommitQueue` (serialized for parallel safety) with message `nova: <task description>`.
- Returns `ExecutionResult` with success status, diff summary, and commit hash.

#### Key Configuration
- `maxFixIterations`: 3 (default) — validation + fix loop iterations.
- `forceSkipValidation`: `true` when called from autofix (auto-fix tasks skip tsc for speed).
- Model selection: Can use micro, standard, or strong models depending on the task complexity.

---

## 5. CodeValidator — `packages/core/src/executor/CodeValidator.ts`

### Purpose
Validates AI-generated code files for correctness before committing. Catches compilation errors, missing imports, and broken relative imports.

### How it works

#### `validateFiles(files, options)`
Main entry point. Takes an array of `{ path, content }` pairs and optional skip flags. Returns `ValidationError[]`.

**Three validation checks:**

1. **TypeScript Compilation** (`runTsc()`):
   - Resolves `tsc` binary: tries project-local `node_modules/.bin/tsc` first, then resolves via `require.resolve('typescript/bin/tsc')`, falls back to `npx tsc`.
   - Runs `tsc --noEmit --pretty false` with 30s timeout in the project directory.
   - Parses output using regex pattern: `path(line,col): error TS1234: message`.
   - **Filters** errors to only include those from generated files (not pre-existing project errors).
   - Handles tsc/npx not found gracefully (returns empty errors).

2. **Import Resolution** (`checkImportsSync()`):
   - Loads and caches installed dependencies from `package.json` once per `validateFiles()` call.
   - Scans each line of generated code for `from 'package-name'` imports.
   - Compares imported package names against installed dependencies.
   - Has a `safePackages` allowlist for Next.js built-in modules (next/link, next/image, next/font, etc.).
   - Reports errors for packages not in `package.json` and not in the safe list.

3. **Relative Import Check** (`checkRelativeImports()`):
   - Currently a stub (returns empty array). Comment notes these checks are complex and tsc catches most cases.

#### Options
- `skipTsc`: Skip TypeScript compilation check (used for CSS-only changes, non-TS files, single small TS files).
- `skipImportCheck`: Skip import resolution check.

---

## 6. CLI Start Command — `packages/cli/src/commands/start.ts`

### Purpose
The main entry point for Nova. This is what runs when a user types `nova` in their project directory. It orchestrates the entire Nova session.

### Step-by-step flow (18 steps)

1. **Config & License**: Reads `nova.toml` config, checks license validity.
2. **Telemetry**: Fire-and-forget telemetry ping.
3. **LLM Provider**: Initializes the AI provider based on config (`apiKeys.provider`). If no key configured, runs interactive setup. Falls back gracefully if no AI is available.
4. **Stack Detection**: Uses `StackDetector` to identify the project framework, language, dev command, and port.
5. **Scaffolding**: If the project is empty/uninitialized, runs `runScaffold()` to generate initial files.
6. **Indexing**: Initializes `.nova/` directory, then runs `ProjectIndexer.index()` to build a `ProjectMap` (routes, components, endpoints, dependency graph, file contexts).
7. **RAG Indexing**: Optionally builds a semantic code search index using embeddings (Ollama > OpenAI > TF-IDF).
8. **Project Analysis**: Runs `ProjectAnalyzer.analyze()` for deep method extraction and project structure analysis.
9. **Port Management**: Handles port conflicts interactively (kill, change, or exit).
10. **Install Dependencies**: Ensures all project dependencies are installed.
11. **Dev Server**: Spawns the dev server (`npm run dev`, etc.) with error recovery (kill port, change port, npm install retry, AI fix).
12. **Proxy & WebSocket**: Starts the HTTP proxy server (dev port + 1 by default), generates a session token, starts the WebSocket server.
13. **Browser**: Opens the browser at `http://localhost:{proxyPort}`.
14. **Git**: Initializes git if needed, creates a working branch.
15. **Executor & AutoFixer**: Creates `ExecutorPool` (Lanes 1-4) and `ErrorAutoFixer`. Wires autofixer to dev server output.
16. **Event Routing** (`setupEventRouting()`): Wires all WebSocket events → Brain → Executor → Overlay communication.
17. **Startup Health Check**: After 4s, scans dev server logs for build errors. If found, routes to autofixer for automatic fixing.
18. **Chat & Shutdown**: Starts the terminal chat REPL for interactive commands. Handles graceful shutdown on SIGINT.

### Event Routing (`setupEventRouting()`)
This is the core interaction loop:
- **Observation → Tasks**: When the overlay sends an observation (user clicked, spoke, typed), the Brain analyzes it and produces one or more `TaskItem`s.
- **Confirmation gate**: Tasks can auto-execute (non-interactive mode, `--yes` flag, pre-confirmed) or wait for user confirmation.
- **Task execution**: Tasks are dispatched to the `ExecutorPool` which routes them to the appropriate lane.
- **Post-task health check**: After a task completes, scans logs for new build errors and auto-fixes if needed.
- **Revert**: Detects `undo`/`revert` keywords and uses `git revert`.

---

## 7. Overall Error-to-Fix Flow

When a user gets an error and the system tries to fix it, here's the complete end-to-end flow:

### A. Compilation/Build Errors (Automatic)

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. Dev server outputs error to stdout/stderr                        │
│     (e.g., "Module not found: Can't resolve './components/Button'")  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. ErrorAutoFixer.handleOutput() detects error via regex patterns   │
│     - Buffers output for 1s debounce                                │
│     - Checks dedup (same error signature?)                          │
│     - Sets isFixing = true                                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. attemptAutoFix() builds task description                         │
│     - Truncates error to 500 chars                                  │
│     - Adds deletion intent if conflicting/duplicate files           │
│     - Adds previous failure context on retry                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. Routes to executor:                                             │
│     - Image error → Lane 3 (skipValidation=true)                    │
│     - Known file in project map → Lane 2 (single-file diff)         │
│     - Unknown / no file → Lane 3 (multi-file generate)              │
│     - Route conflict → Lane 3 with conflicting file list            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. Lane 2 (Fast):                                                  │
│     - Builds prompt with file context + line numbers                │
│     - LLM returns unified diff                                      │
│     - DiffApplier applies diff (LCS-based, validates context)       │
│     - Commits via CommitQueue                                       │
│                                                                     │
│  OR                                                                 │
│                                                                     │
│  Lane 3 (Thorough):                                                 │
│     - Builds prompt with project context + files + packages         │
│     - LLM streams back FILE/DIFF/DELETE blocks                      │
│     - applyMixedBlocks() writes files / applies diffs / deletes     │
│     - Syntax check (bracket balancing)                              │
│     - CodeValidator validates (tsc + import checks)                 │
│     - CodeFixer fixes errors via LLM (up to 3 iterations)           │
│     - EnvDetector finds missing env vars                            │
│     - Commits via CommitQueue                                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  6. On success:                                                     │
│     - Emits task_completed event → overlay shows "done"             │
│     - Emits autofix_end status                                      │
│     - Dev server hot-reloads with fixed code                        │
│                                                                     │
│  On failure:                                                        │
│     - Records failed task ID                                        │
│     - Retries up to 3 times (clears .next/cache between retries)    │
│     - Each retry includes previous failure as context               │
│     - After all retries exhausted: emits autofix_budget_exhausted   │
│     - 60s cooldown before accepting new errors                      │
└─────────────────────────────────────────────────────────────────────┘
```

### B. User-Initiated Changes (Observations)

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. User interacts with the browser overlay:                        │
│     - Clicks an element + types instruction                         │
│     - Speaks a voice command                                        │
│     - Draws a gesture (circle, path)                                │
│     → Overlay sends Observation via WebSocket                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. EventRouter receives observation                                │
│     → Emits to EventBus                                             │
│     → Brain.analyze() called with observation + ProjectMap           │
│     → LLM decomposes into TaskItem[] or clarifying question         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. Tasks classified into lanes:                                    │
│     - Lane 1: CSS/text changes → regex/AST (no LLM)                 │
│     - Lane 2: Single-file → single LLM call → diff                  │
│     - Lane 3: Multi-file → LLM + validation loop                    │
│     - Lane 4: Large refactors → background queue                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. Tasks confirmed (auto or manual)                                │
│     → ExecutorPool.execute(task, projectMap)                        │
│     → Appropriate lane executor runs                                │
│     → Code changes committed                                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. Post-task health check (1500ms after task_completed):           │
│     - Scans dev server logs for new build errors                    │
│     - HTTP pings dev server (checks for 5xx)                        │
│     - If errors detected → autoFixer.forceFixNow(errors)            │
│     - Only if task was NOT already an autofix task                  │
└─────────────────────────────────────────────────────────────────────┘
```

### C. Startup Health Check

```
┌─────────────────────────────────────────────────────────────────────┐
│  4 seconds after startup:                                           │
│     - Scans dev server logs for error patterns                      │
│     - If errors found and autofixer is configured:                  │
│       → autoFixer.forceFixNow(errors)  (bypasses debounce/dedup)    │
│     - If autofixer not available (no AI configured):                │
│       → Routes through Brain (may produce clarifying questions)     │
│       → Shows pending tasks to user for confirmation                │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Safety Mechanisms

1. **PathGuard**: All file writes go through PathGuard which rejects `..` traversal and absolute paths.
2. **Branch isolation**: All changes committed to a separate git branch (never main).
3. **CommitQueue**: Serializes commits to prevent race conditions when multiple tasks execute in parallel.
4. **Cooldown**: Autofixer has 60s cooldown after exhausting attempts to prevent infinite loops.
5. **Safety timeout**: Autofixer has a 5-minute hard timeout; `isFixing` flag auto-resets.
6. **Git revert**: Users can type `undo` to revert the last commit.

---

## Key Architectural Patterns

1. **Event-driven**: `NovaEventBus` connects all components — overlay sends observations, Brain emits tasks, executors emit progress/status, overlay displays results.
2. **Separation of concerns**: CLI (orchestration), Core (AI logic), Proxy (HTTP/WS transport), Overlay (browser UI), Licensing (compliance).
3. **Streaming LLM**: `streamWithEvents()` streams LLM output token-by-token, emitting `llm_chunk` events so the overlay can show real-time progress.
4. **Iterative validation**: Lane 3's tester/director loop mirrors a CI pipeline — generate, validate, fix, repeat.
5. **Graceful degradation**: If no AI provider is configured, Nova runs without AI. If tsc is not found, validation is skipped. If embedding service is unavailable, RAG defaults to TF-IDF.
