# Nova Autofix & Execution System — Deep Dive

## 1. Executive Summary

Nova is an AI-powered code generation and auto-fix system designed for interactive web development. It watches dev server output for compilation errors, captures browser console errors, and can automatically fix them by routing them through a multi-lane execution pipeline.

The system has three major architectural layers:
- **Overlay** (browser): Captures user intent (voice, clicks, gestures) and console errors, sends them to the CLI server via WebSocket
- **CLI** (Node.js): Orchestrates the Brain (LLM analysis), AutoFixer (error detection/fixing), and ExecutorPool (code generation/application)
- **Core** (shared engine): Contains the execution lanes, validation, diff application, git management, and LLM interaction

---

## 2. Autofix System (`packages/cli/src/autofix.ts`)

### 2.1 ErrorAutoFixer Class

The `ErrorAutoFixer` is the central class that watches for build/compilation errors and automatically fixes them. Key characteristics:

**Error Detection:**
- Uses regex patterns to detect fixable compilation errors:
  - `Module not found: Can't resolve '...'`
  - Invalid next/image `src` prop
  - Unconfigured image hostnames
  - SyntaxErrors, TypeErrors
  - Generic "Build error", "Compilation failed", "Failed to compile"
  - Error boundary issues
- Separately detects **image-related errors** (broken images, missing hostname config, etc.)

**Debounce & Cooldown:**
- Errors are buffered with a 1-second debounce before processing
- After failing `MAX_FIX_ATTEMPTS` (3), a 60-second cooldown prevents re-triggering
- Deduplication: if the same error signature (first 200 chars) appears repeatedly, increment `fixAttempts`; reset when different error detected

**Fix Strategy (Retry Loop):**
```
For attempt 1..MAX_FIX_ATTEMPTS (3):
  1. Clear Next.js/Turbopack cache (starting attempt 2)
  2. Build task description with previous failure context
  3. Route to Lane 2 or Lane 3 based on error type:
     - Image errors → Lane 3 (multi-file, skip validation)
     - Compilation errors → Try Lane 2 (single file, diff-based) first if file identified
       Fall back to Lane 3 (multi-file) otherwise
     - Route conflicts (App Router vs Pages Router) → Lane 3 with explicit DELETE instructions
  4. If success → emit events, return
  5. If failure → record error, retry with different approach
```

**Deletion Intent Detection:**
- When errors mention "conflicting", "duplicate route", "both match", "already exists", etc., the prompt explicitly instructs the LLM to **DELETE** one of the conflicting files rather than creating new ones
- Uses `=== DELETE: path/to/file.tsx ===` blocks for file removal

**Backward Compatibility:**
- `fixImageError()`, `fixCompilationError()`, `fixWithLane2()`, `fixWithLane3()` legacy wrappers still call `attemptAutoFix()` internally

### 2.2 Where Autofix is Triggered

1. **Startup health check** (`commands/start.ts`, ~4 seconds after boot):
   - Scans dev server logs for errors
   - If errors found → calls `autoFixer.forceFixNow()`
   - Fallback: routes through Brain if no autoFixer configured

2. **Continuous dev server output** (`commands/start.ts`):
   - `devServer.onOutput()` pipes ALL stdout/stderr to `autoFixer.handleOutput()`

3. **Post-task health check** (`boot/EventRouter.ts`):
   - After each task completes (1.5s delay): scans dev server logs for errors
   - Also performs HTTP health check (GET dev server, check for 5xx)
   - Auto-fixes if errors detected

4. **Browser console errors** (`boot/EventRouter.ts`):
   - `wsServer.onBrowserError()` → `autoFixer.handleOutput()`

5. **Post-revert cleanup**:
   - After `git revert`, emits `autofix_end` status to dismiss overlay indicators

### 2.3 Overlay Integration (autofix status)

The overlay (`packages/overlay/src/index.ts`) tracks `autofixInProgress` flag:
- `autofix_start` → set flag true, show "Fixing build errors..." toast
- `autofix_end` → set flag false, dismiss toast
- `autofix_failed` → set flag false, dismiss toast, show error
- While `autofixInProgress`: block voice commands, gesture tracking, dead-click detection, browser error reporting

---

## 3. Execution Pipeline

### 3.1 Overview

The execution system is a multi-lane architecture where each lane handles different complexity levels:

| Lane | Complexity | Method | Model | Fallback |
|------|-----------|--------|-------|----------|
| **1** | CSS/text/visibility | Regex/AST, no LLM | N/A | Lane 3 (micro) |
| **2** | Single-file changes | LLM generates unified diff | Micro/Standard | Lane 3 (standard) |
| **3** | Multi-file generation | LLM generates FILE/DIFF/DELETE blocks | Strong | N/A |
| **4** | Background refactors | Queued → delegates to Lane 3 | Strong | Lane 3 |

### 3.2 Lane 1: `Lane1Executor` — Deterministic (No LLM)

File: `packages/core/src/executor/Lane1Executor.ts`

Handles simple, deterministic changes without calling any LLM. The executor tries three parsers in order:

**Parser 1 — Text Changes (`parseTextChange`):**
- Patterns: "change placeholder from 'A' to 'B'", "set label to 'X'", "replace 'Hello' with 'World'"
- Supports attributes: placeholder, label, title, alt, aria-label, text (bare JSX text)
- Searches `.tsx`, `.jsx`, `.html`, `.vue` files
- Uses regex to find/replace in source

**Parser 2 — CSS Property Changes (`parsePropertyChange`):**
- Patterns: "color: red to color: blue", "change margin from 10px to 20px", "set background to #fff"
- Whitelist of 26 known CSS property names to avoid false positives
- When DOM snapshot is available (Quick Edit mode), performs **element-scoped** modification:
  1. Extract element's text content from DOM snapshot
  2. Find matching text in source file
  3. Backtrack to the opening JSX tag
  4. Modify or create `style={{...}}` prop on that specific element
- When CSS class is available, narrows to that class's block
- Otherwise falls back to global search-and-replace
- Searches `.css`, `.scss`, `.sass`, `.less`, `.styl` files + component files

**Parser 3 — Config Changes (`parseConfigChange`):**
- Patterns: "change port to 4000", "set timeout to 5000"
- Detects by exclusion: key is NOT a CSS property and NOT a text attribute
- Searches `.json`, `.toml`, `.yaml`, `.yml`, `.env` files
- Handles each format correctly (JSON parse/write, TOML regex, YAML regex, .env regex)
- Preserves value types (numbers stay numbers in JSON)

**Fallback:** If Lane 1 fails, falls back to Lane 3 with micro model (ExecutorPool logic)

### 3.3 Lane 2: `Lane2Executor` — Single-File Diff

File: `packages/core/src/executor/Lane2Executor.ts`

Sends the file content (with line numbers) + task description to the LLM, expects a unified diff back.

**Flow:**
1. Load mini-context for the target file (from ProjectMap)
2. Build prompt: "File: {path}\n\nImported types: {...}\n\nCurrent content (numbered):\n```\n{numberedContent}\n```\n\nModification: {description}"
3. System prompt instructs: "Respond with ONLY a valid unified diff... output ONLY changed hunks"
4. Call LLM with `temperature: 0, maxTokens: 4096`
5. `extractDiff()` strips markdown fences, finds diff starting with `---` or `@@`
6. `DiffApplier.apply()` parses hunks, validates context lines, applies changes
7. Commit via `CommitQueue`

**Uses:** micro model (Lane 2 only), falls back to standard model via Lane 3

### 3.4 Lane 3: `Lane3Executor` — Multi-File Generation

File: `packages/core/src/executor/Lane3Executor.ts`

The most complex executor, implements a developer→tester→director loop.

**Phase 1 — Developer (Code Generation):**
1. Build a comprehensive prompt including:
   - Project stack info (framework + language)
   - Task description + target files
   - Existing file listing
   - Key file contents with line numbers (for existing files → DIFF; for new files → FILE)
   - Available packages from package.json
2. Load agent prompt: custom from `.nova/agents/developer.md` or built-in default
3. Send combined prompt to LLM via `streamWithEvents()` (streaming)
4. Parse response with `parseMixedBlocks()` → supports three block types:
   - `=== FILE: path ===` ... `=== END FILE ===` → full file content (new files)
   - `=== DIFF: path ===` ... `=== END DIFF ===` → unified diff (existing files)
   - `=== DELETE: path ===` → file deletion
   - Fallback: legacy `parseFileBlocks()` and markdown code blocks

**Phase 2 — Block Application:**
1. `applyMixedBlocks()` writes FILE blocks directly, applies DIFF blocks via DiffApplier, deletes DELETE blocks
2. **Failed diff retry**: if a diff couldn't be applied (context mismatch), requests full file content from LLM via `retryFailedDiffsAsFullFiles()`
3. If no files written/deleted → fail early

**Phase 2.5 — Syntax Check:**
- Quick bracket balance check on generated JS/TS files (`hasBalancedBrackets()`)
- Allows small imbalance (±1) for template literals
- If unbalanced, re-ask LLM for corrected full file

**Phase 3 — Env Var Detection:**
- Scan generated code for `process.env.VAR_NAME` references
- Exclude `NODE_ENV`, `PORT`, `CI`, `HOME`, `PATH`, etc. and `NEXT_PUBLIC_*` vars
- Cross-reference with `.env.local` to find missing vars
- Emit `secrets_required` event if any found

**Phase 4 — Tester/Director Validation Loop:**
```
For iteration 1..maxFixIterations (default 3):
  1. Tester: Run CodeValidator.validateFiles()
     - tsc --noEmit (filtering to only generated files)
     - Import resolution check (package.json deps, safe packages)
     - Relative import check (stub — skipped)
  2. If no errors → break (PASS)
  3. Director: If max iterations reached → commit with warnings
  4. Director: Send errors to CodeFixer.fixErrors()
     - LLM receives files + errors + project context
     - Returns corrected full file blocks
  5. Write fixed files, update currentBlocks, repeat
```

**Skip Validation Logic:**
- `forceSkipValidation` (used by autofix) or single small file (< 3000 chars) → skip entirely
- `shouldSkipTsc()`: CSS-only → skip both; non-TS files → skip both; single small TS file → skip tsc only

**Commit:** All changes committed via `CommitQueue` (serialized for parallel safety). Deleted files tracked separately and reported in diff output.

### 3.5 Lane 4: `Lane4Executor` — Background Queue

File: `packages/core/src/executor/Lane4Executor.ts`

For long-running refactoring tasks. Delegates to Lane 3 on a separate git branch.

**Flow:**
1. Enqueue task to `BackgroundQueue` (file-system backed JSON queue)
2. Emit `background_queued` event with position
3. Fire-and-forget background processing:
   - Create git branch `nova/bg-{random}`
   - Execute Lane 3 on that branch
   - Update queue status (running → completed/failed)
4. Polling loop: every 5 seconds, dequeues and processes next queued task

**BackgroundQueue** (`BackgroundQueue.ts`):
- File-system based: each task stored as `{id}.json` in a queue directory
- Supports: enqueue, dequeue (FIFO by queuedAt), update, getAll, getPending, remove, clear
- Crash-resilient: tasks persist on disk

### 3.6 ExecutorPool: Central Dispatch

File: `packages/core/src/executor/ExecutorPool.ts`

Routes tasks to the correct lane and manages fallbacks:
- Lane 1 fails → Lane 3 (micro model)
- Lane 2 fails → Lane 3 (standard model)
- Lane 3/4 → strong model, no fallback
- Tracks task state via `ExecutorFSM`

### 3.7 ExecutorFSM: State Machine

File: `packages/core/src/executor/ExecutorFSM.ts`

States: `Planning → Generating → Applying → Validating → Fixing → Committing | Failed`

Each transition is logged and emitted as an `fsm_transition` event with correlation ID (taskId).

### 3.8 RetryPolicy

File: `packages/core/src/executor/RetryPolicy.ts`

Pool-level retry with exponential backoff: 1s, 2s, 4s (3 max per task).

---

## 4. File Operations (`fileBlocks.ts`)

File: `packages/core/src/executor/fileBlocks.ts`

**Key types:**
```typescript
interface FileBlock { path: string; content: string }
interface DiffBlock { path: string; diff: string }
type ParsedBlock =
  | { type: 'file'; path: string; content: string }
  | { type: 'diff'; path: string; diff: string }
  | { type: 'delete'; path: string }
```

**Parsing functions:**
- `parseFileBlocks()`: Legacy — only parses `=== FILE: ... ===` ... `=== END FILE ===` blocks. Fallback: markdown code blocks with filename comments.
- `parseMixedBlocks()`: Modern — parses FILE, DIFF, and DELETE blocks. Validates diffs have `@@` or `---` hunk headers. If DIFF block doesn't look like a real diff, treats it as FILE content (model output regression).

**Security:**
- `sanitizePath()`: Strips leading `/`, rejects `..` segments (path traversal prevention)

**Utilities:**
- `addLineNumbers()`: Formats content as `"1 | code"` for LLM context

---

## 5. Diff Application (`DiffApplier.ts`)

File: `packages/core/src/executor/DiffApplier.ts`

**Apply flow:**
1. Parse diff into hunks: `@@ -oldStart,oldCount +newStart,newCount @@`
2. Sort hunks in **reverse** order (so line numbers stay valid during modifications)
3. For each hunk, apply in reverse order:
   - Validate context lines match the actual file (throws `DiffError` on mismatch)
   - Remove lines marked with `-`, insert lines marked with `+`
4. Write result to disk

**Generate flow:**
1. Compute LCS (Longest Common Subsequence) between before/after
2. Generate minimal diff hunks with 3 lines of context
3. Merge hunks that are close together (≤ 6 context lines gap)

**Edge cases handled:**
- `\ No newline at end of file` markers
- Empty lines within hunks treated as context
- Hunks applied in reverse order for correctness

---

## 6. Code Validation & Fixing

### 6.1 CodeValidator (`CodeValidator.ts`)

**Checks:**
1. **TypeScript** (`tsc --noEmit --pretty false`): Runs in project directory, parses output for `path(line,col): error TS####: message` pattern. Filters to only generated files.
2. **Import resolution** (sync, per-file): Checks that every `from 'package-name'` import matches a dependency in package.json. Safe packages (react, next/\*, etc.) are whitelisted.
3. **Relative imports**: Stub — skipped (complex, tsc catches most).

**Performance optimizations:**
- Installed deps loaded once per validation session (cached)
- Timeout: 30s for tsc

### 6.2 CodeFixer (`CodeFixer.ts`)

Purpose: Fix validation errors found by CodeValidator.

**Flow:**
1. Build prompt with: project context (framework/language), available deps, files with errors (numbered lines), error list
2. Send to LLM with temperature 0, maxTokens 8192
3. Parse `=== FILE: ... ===` ... `=== END FILE ===` blocks from response
4. Merge: for files returned by LLM, use fixed content; for others, keep original

**System prompt emphasizes:** "Fix ALL errors... Only output files that need changes... Do NOT add imports for packages not in package.json."

### 6.3 Validator (`Validator.ts`)

Standalone validator (distinct from CodeValidator) used for full project validation:
- tsc --noEmit
- eslint (if config exists)
- npm run build (timeout 30s)

---

## 7. Overlay Package (`packages/overlay`)

### 7.1 Purpose
Browser-side IIFE script injected into the user's web app via the proxy server. Provides:
- Visual UI overlaid on the dev site (pill, panels, modals)
- Capture capabilities (screenshot, DOM, voice, console errors, gestures)
- WebSocket transport to communicate with CLI server

### 7.2 Capture Modules

| Module | File | Purpose |
|--------|------|---------|
| `ScreenshotCapture` | `ScreenshotCapture.ts` | Viewport → PNG blob (html2canvas) |
| `DomCapture` | `DomCapture.ts` | Element + 2 parent levels → cleaned HTML |
| `VoiceCapture` | `VoiceCapture.ts` | Web Speech API → transcript + amplitude |
| `ConsoleCapture` | `ConsoleCapture.ts` | Intercepts console.error/warn, buffers last 20 |
| `CursorTracker` | `CursorTracker.ts` | Cursor position trail for gestures |
| `GestureRecognizer` | `GestureRecognizer.ts` | Circle/Path/Dwell gesture detection |
| `TemporalCorrelator` | `TemporalCorrelator.ts` | Voice + gesture time alignment |

### 7.3 ConsoleCapture Details

- Installs monkey-patches on `console.error` and `console.warn`
- Original console methods preserved (output still shown) — non-destructive
- Formats: `[error] message` or `[warn] message`
- Errors: uses `error.stack || error.message`
- Objects: JSON.stringify
- Max 20 errors, oldest evicted (FIFO ring buffer)
- Event-based notification to registered handlers
- Idempotent install/uninstall

### 7.4 UI Components

| Component | Purpose |
|-----------|---------|
| `OverlayPill` | Floating action button (idle/listening/processing/error states) |
| `CommandInput` | Text command input |
| `ElementSelector` | Click-to-select element |
| `ElementInspector` | Inspect element + type instruction → auto-execute |
| `MultiElementSelector` | Select multiple elements + instruction → auto-execute |
| `AreaSelector` | Gesture-based area selection |
| `StatusToast` | Toast notifications (supports persistent toasts via 0 timeout) |
| `TranscriptBar` | Shows current transcript |
| `TaskPanel` | Lists pending/completed tasks |
| `ActivityLog` | Chronological activity log with diff viewing |
| `DiffModal` | Shows file diff with open-in-editor and revert buttons |
| `SuggestionPanel` | AI suggestions for the current page |
| `SecretConsole` | Prompt for entering missing env vars |

### 7.5 FSM States

```
idle ↔ listening ↔ thinking → applying → idle
                    ↓
              awaiting-confirmation ↔ idle
idle ↔ quick-edit ↔ idle
idle ↔ multi-edit ↔ idle
idle ↔ gesture ↔ idle
```

### 7.6 Error Reporting Flow

1. `ConsoleCapture` intercepts console.error/warn
2. Overlay code periodically checks captured errors (polling on a timer)
3. Non-autofix errors sent to server via `wsClient.sendRaw({ type: 'browser_error', data: { error } })`
4. Server's `EventRouter` routes to `autoFixer.handleOutput()`
5. Autofix state blocks error reporting (don't report while fixing)

---

## 8. Agent/Worker Patterns

### 8.1 Agent Prompt System

The system has a "developer/tester/director" agent model inspired by the CLAUDE.md workflow:

**Agent Prompts** (`packages/core/src/storage/agentPrompts.ts`):
- `developer`: Code generation bot — "You output ONLY code. No explanations."
- `tester`: Validation bot — structured verdict with PASS/FAIL and error list
- `director`: Review bot — APPROVED/NEEDS_REVISION/REJECTED with specific action items

**Agent Prompt Loader** (`packages/core/src/storage/AgentPromptLoader.ts`):
- Loads agent prompts from `.nova/agents/{name}.md` (user-customizable)
- Falls back to built-in defaults if file missing or empty

**Usage:**
- Lane 3 uses developer prompt for code generation
- Lane 4 passes agentPromptLoader to Lane 3
- The developer/tester/director loop is partially implemented in Lane 3 (validation + fixing), but the full separate-agent model from CLAUDE.md is not fully realized

### 8.2 "Worker" and "Agent" Terms

- "worker" appears in: `AgentPromptLoader` (agent names like "developer"), test files (path-guard tests mentioning "worker agent")
- "agent" appears in: `AgentPromptLoader`, `agentPrompts.ts`, `NovaDir.ts`, `Lane3Executor.ts`, `Lane4Executor.ts`, `ExecutorPool.ts` (all using `agentPromptLoader`), manifest/schema (agent definitions)

There is **no separate worker process model** — agents are purely prompt-based (different system prompts for different roles).

---

## 9. Mission/Orchestrator Patterns

The term "mission" appears in:
- CLI config (`config.ts`): `missions: { enabled: boolean; defaultPath: string }` — a user-facing feature for multi-step workflows
- Boot port manager tests
- Overlay contracts, VoiceCapture tests

The term "orchestrator" does **not** appear in the codebase. The orchestration is done by:
- `EventRouter` (boot/EventRouter.ts): Wires WebSocket events to Brain + Executor + AutoFixer
- `startCommand` (commands/start.ts): Initializes all components and wires them together
- `ExecutorPool`: Routes tasks to lanes with fallbacks

---

## 10. Compilation/Build Error Handling Summary

### 10.1 Error Detection Sources

| Source | Where Detected | Handler |
|--------|---------------|---------|
| Dev server stdout/stderr | `devServer.onOutput()` in start.ts | `autoFixer.handleOutput()` |
| Browser console.error/warn | Overlay ConsoleCapture → WS → server | `autoFixer.handleOutput()` via `wsServer.onBrowserError()` |
| Startup health check (4s delay) | `startCommand()` in start.ts | `autoFixer.forceFixNow()` |
| Post-task health check (1.5s after commit) | `EventRouter` task_completed handler | `autoFixer.forceFixNow()` |

### 10.2 Error Patterns Detected

```typescript
ERROR_PATTERNS = [
  /Module not found: Can't resolve '([^']+)'/,
  /Invalid src prop.*next\/image/i,
  /hostname.*is not configured under images/i,
  /SyntaxError:\s+(.+)/,
  /TypeError:\s+(.+)/,
  /Build error/i,
  /Compilation failed/i,
  /Failed to compile/i,
  /Error boundary caught/i,
];
```

### 10.3 Fix Strategy by Error Type

| Error Type | Lane | Validation | Model |
|------------|------|-----------|-------|
| Module not found / SyntaxError / TypeError | Lane 2 (if file identified) → Lane 3 (fallback) | Skipped (autofix) | Micro/Standard |
| Image errors (broken images, missing hostname) | Lane 3 | Skipped (autofix) | Micro |
| Route conflicts (App Router vs Pages Router) | Lane 3 + DELETE prompt | Skipped | Micro |
| Generic build errors | Lane 3 (no file identified) | Skipped | Micro |

### 10.4 Key Behaviors

- **Cache clearing**: Next.js `.next/cache` cleared before retry attempts 2+
- **Budget exhaustion**: After 3 failed attempts, 60s cooldown, emit `autofix_budget_exhausted`
- **Post-task health**: 1.5s after each successful task, scans logs AND does HTTP GET on dev server
- **Autofix tasks** tracked in `autofixTaskIds` set; post-task health check skips these (don't fix the fix)
- **No validation for autofix**: `skipValidation: true` passed to Lane 3 to avoid tsc delays during auto-fix

---

## 11. Key Architectural Patterns

### 11.1 File Operation Safety
- All file writes go through `PathGuard` → prevents traversal outside project
- Paths stripped of leading `/`, `..` rejected
- `CommitQueue` serializes git operations for parallel safety
- Branch-based work: changes on separate git branch

### 11.2 Secret Handling
- `EnvDetector` scans generated code for `process.env.VAR`
- Emits `secrets_required` event → overlay shows `SecretConsole`
- Secrets written to `.env.local` (auto-added to `.gitignore`)
- API keys in `.nova/config.toml` (gitignored)

### 11.3 Event-Driven Architecture
- `EventBus` (observer pattern) connects all components
- Events: `observation`, `task_created`, `task_started`, `task_completed`, `task_failed`, `status`, `llm_chunk`, `secrets_required`, `fsm_transition`, `file_changed`, `background_*`
- WebSocket bridges events to browser overlay

### 11.4 Streaming
- `streamWithEvents()` sends LLM chunks to overlay in real-time via `llm_chunk` events
- Used by Lane 3 for showing generation progress

---

## 12. File Reference Map

| File | Purpose |
|------|---------|
| `packages/cli/src/autofix.ts` | ErrorAutoFixer class — watches/fixes build errors |
| `packages/cli/src/commands/start.ts` | Boot sequence, wires all components, triggers startup autofix |
| `packages/cli/src/boot/EventRouter.ts` | WebSocket event routing, post-task health checks |
| `packages/core/src/executor/Lane1Executor.ts` | Deterministic CSS/text/config changes (no LLM) |
| `packages/core/src/executor/Lane2Executor.ts` | Single-file diff-based LLM changes |
| `packages/core/src/executor/Lane3Executor.ts` | Multi-file LLM generation + validation loop |
| `packages/core/src/executor/Lane4Executor.ts` | Background queue with git branch isolation |
| `packages/core/src/executor/ExecutorPool.ts` | Central lane dispatch with fallbacks |
| `packages/core/src/executor/ExecutorFSM.ts` | Task state machine (Planning→Committing/Failed) |
| `packages/core/src/executor/fileBlocks.ts` | FILE/DIFF/DELETE block parsing + path sanitization |
| `packages/core/src/executor/DiffApplier.ts` | Unified diff parsing, application, and generation |
| `packages/core/src/executor/CodeValidator.ts` | tsc + import validation for generated files |
| `packages/core/src/executor/CodeFixer.ts` | LLM-based fixer for validation errors |
| `packages/core/src/executor/Validator.ts` | Standalone project validator (tsc+eslint+build) |
| `packages/core/src/executor/EnvDetector.ts` | Detect/write missing env vars |
| `packages/core/src/executor/RetryPolicy.ts` | Exponential backoff retry (1s, 2s, 4s) |
| `packages/core/src/executor/BackgroundQueue.ts` | File-system backed background task queue |
| `packages/core/src/brain/Brain.ts` | LLM-based observation→task decomposition |
| `packages/core/src/brain/LaneClassifier.ts` | Task→lane classification (keyword-based) |
| `packages/core/src/storage/AgentPromptLoader.ts` | Custom agent prompt loading from .nova/agents/ |
| `packages/core/src/storage/agentPrompts.ts` | Default developer/tester/director prompts |
| `packages/overlay/src/index.ts` | Overlay boot, UI mounting, event handling |
| `packages/overlay/src/capture/ConsoleCapture.ts` | Browser console error interception |
| `packages/core/src/contracts/IExecutor.ts` | Executor interfaces + DiffError definition |
| `packages/core/src/contracts/IStorage.ts` | Storage interfaces (GraphStore, AgentPromptLoader, etc.) |
| `docs/ARCHITECTURE.md` | High-level architecture documentation |
