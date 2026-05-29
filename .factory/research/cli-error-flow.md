# CLI Error Prompt Flow — Research Findings

## 1. `start.ts` — "What would you like to do?" & "Describe what to fix:" prompts

File: `packages/cli/src/commands/start.ts`

There are **three** separate error/interactive paths in `start.ts`:

### A. Port Conflict Prompt (`acquirePorts` function, ~lines 390–430)

Triggered when `PortManager.isPortInUse(devPort)` or `PortManager.isPortInUse(proxyPort)` returns true.

Shows `"What would you like to do?"` with choices:
- `[k] Kill processes on <port>` — calls `PortManager.killPort()`
- `[p] Use different port` — shows `input({ message: 'Dev server port:' })`
- `[c] Cancel` — `process.exit(0)`

Uses `@inquirer/prompts` imported dynamically:
```ts
const { select, input } = await import('@inquirer/prompts');
```

### B. Dev Server Recovery Prompt (`recoverDevServer` function, ~lines 435–520)

Triggered when `devServer.spawn()` throws (caught at line ~230 of `startCommand`).

Error context available at this point:
- `msg` — `err.message` (string), e.g., "Dev server error:\n\nEADDRINUSE: address already in use :::3000"
- `devCommand` — the command string being run
- `cwd` — project directory
- `devPort` — the port number
- `options` — full StartOptions
- `llmClient` — the configured LLM client (or null)
- `devServer` — the DevServerRunner instance

Choices are dynamically built based on error content:
| Error pattern | Choice added |
|---|---|
| `EADDRINUSE` / `address already in use` | `[k] Kill port & retry`, `[p] Change port` |
| `Cannot find module` / `MODULE_NOT_FOUND` | `Run npm install & retry` |
| `EJSONPARSE` / `JSON` | `Fix package.json & retry` |
| `llmClient` exists | `AI fix` |
| Always | `Exit` |

**"AI fix" → "Describe what to fix:" transition:**
```ts
if (action === 'ai-fix') {
  const desc = await input({ message: 'Describe what to fix:' });
  // ... raw LLM call, parse FILE blocks, write files, retry spawn
}
```

### C. Startup Health Check (inline `setTimeout`, ~lines 290–320)

Runs 4 seconds after dev server starts. Checks `devServer.getLogs()` for error patterns:
```ts
/error|Error|failed|Module not found|SyntaxError|Cannot find/i
```
(but excludes lines matching `warning|warn|deprecat`)

If errors found:
- **With autoFixer** → `autoFixer.forceFixNow(errors)` (direct, no interactive prompt)
- **Without autoFixer** → creates pending TaskItem via Brain; in non-interactive mode auto-executes, otherwise sends `pending_tasks` WS event (Y/N confirmation)

This path is **non-interactive** — no `@inquirer/prompts` involvement.

---

## 2. Interactive Prompt System

### Library
Uses `@inquirer/prompts` (standard Inquirer.js v5+). Imported **dynamically** in all production code:
```ts
const { select, input } = await import('@inquirer/prompts');
// or in Installer.ts (static import for bundled use):
import { select, input } from '@inquirer/prompts';
```

### Files using `@inquirer/prompts`
| File | Prompts used | Purpose |
|---|---|---|
| `commands/start.ts` | `select`, `input` | Port conflict & dev server recovery |
| `boot/Installer.ts` | `select`, `input` | Dependency install recovery (static import) |
| `boot/ScaffoldRunner.ts` | `input` | Scaffold generation prompts |
| `setup.ts` | `select`, `password`, `confirm` | Initial Nova setup wizard |
| `scaffold.ts` | `select`, `input`, `Separator` | Project scaffold generation |
| `telemetry.ts` | `confirm` | Telemetry consent prompt |

### "AI fix" option handling patterns

**Pattern 1 — recoverDevServer (start.ts):**
1. User selects `{ name: 'AI fix', value: 'ai-fix' }` from select menu
2. `input({ message: 'Describe what to fix:' })` prompts for user description
3. Raw LLM call with system prompt `"Output fixed files:\n=== FILE: path ===\ncontent\n=== END FILE ==="`
4. Regex-parses `=== FILE: ... ===` / `=== END FILE ===` blocks from LLM response
5. Writes files, retries `devServer.spawn()`

**Pattern 2 — handleAiFix (Installer.ts):**
1. User selects `{ name: 'Describe what to fix (AI will handle it)', value: 'ai-fix' }` from select menu
2. `input({ message: 'Describe what needs to be fixed:' })` prompts for user description
3. Raw LLM call with similar system prompt + error context + user description
4. Same FILE block parsing, writes files, retries install

**Both patterns share the same limitations** (see section 4).

---

## 3. Dev Server Error Capture & Display

File: `packages/proxy/src/DevServerRunner.ts`

### Architecture
`DevServerRunner` spawns the dev command as a child process and captures all output.

### `spawn(command, cwd, port)`
- Validates command with `validateCommand()` (shell-quote parsing, rejects operators)
- Calls `child_process.spawn(cmd, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })`
- Sets `env.PORT` to the requested port
- Attaches `handleOutput` to both `stdout` and `stderr`

### `handleOutput(data: Buffer)`
```ts
const text = data.toString();
this.logs.push(text);                          // Store for getLogs()
// Check for port redirect (e.g., "listening on port 3001")
const portMatch = PORT_REDIRECT_PATTERN.exec(text);
// Check for startup errors (ERROR_PATTERNS)
for (const pattern of ERROR_PATTERNS) { ... this.startupError = text.trim(); }
// Notify all output handlers (autoFixer.handleOutput, etc.)
for (const handler of this.outputHandlers) { handler(text); }
```

### ERROR_PATTERNS (in DevServerRunner)
```ts
/port \d+ is in use/i, /EADDRINUSE/i, /already running/i,
/address already in use/i, /failed to start/i, /error:/i
```

### PORT_REDIRECT_PATTERN
```ts
/(?:using (?:available )?port|listening on|Local:\s+http:\/\/\S+:)(\d+)/i
```

### Error Flow Summary
```
Dev server process
  ├─ stdout/stderr → handleOutput()
  │   ├─ this.logs[] (for getLogs())
  │   ├─ PORT_REDIRECT_PATTERN → this.detectedPort
  │   ├─ ERROR_PATTERNS check → this.startupError
  │   └─ outputHandlers → autoFixer.handleOutput(chunk)
  │
  ├─ process 'exit' (non-zero) → errorHandler(err) → WS event to overlay
  ├─ process 'error' → errorHandler(err.message) → WS event to overlay
  │
  └─ pollUntilReady() rejection
      └─ caught in start.ts → recoverDevServer(err, ...) → interactive prompt
```

### Wiring in start.ts
```ts
// Continuous output → autoFixer (debounced, pattern-matched)
devServer.onOutput((o: string) => autoFixer?.handleOutput(o));

// Fatal error → WS status event to overlay
devServer.onError((e: string) => {
  if (!shuttingDown)
    wsServer.sendEvent({ type: 'status', data: { message: `Dev server error: ${e}` } });
});
```

---

## 4. "AI fix" → "Describe what to fix:" → Fix Code Path

### The recoverDevServer path (start.ts)

```
User selects "AI fix"
  │
  ├─ input({ message: 'Describe what to fix:' })
  │   └─ User types freeform description (e.g., "The port was already in use")
  │
  ├─ llmClient.chat([
  │     { role: 'system', content: 'Output fixed files:\n=== FILE: path ===\ncontent\n=== END FILE ===' },
  │     { role: 'user', content: `Error: ${msg.slice(0, 800)}\nUser: ${desc.trim()}` }
  │   ], { temperature: 0, maxTokens: 4096 })
  │
  ├─ Parse response for === FILE: path === / === END FILE === blocks
  │   └─ Regex: /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g
  │
  ├─ Write files (mkdirSync + writeFileSync)
  │
  └─ Retry: await devServer.spawn(devCommand, cwd, devPort)
```

### What context is passed along

| Data | Passed? | Notes |
|---|---|---|
| Error message | ✅ `msg.slice(0, 800)` | Truncated to 800 chars; full error from `err.message` |
| User description | ✅ `desc.trim()` | Free-form text from input prompt |
| Dev command | ❌ | Not sent to LLM |
| Project path (cwd) | ❌ | Not sent to LLM |
| Port number | ❌ | Not sent to LLM |
| Project map / file list | ❌ | LLM has no project context |
| Stack / framework | ❌ | Not sent to LLM |

### What is **lost** compared to the ErrorAutoFixer path

| Feature | recoverDevServer "AI fix" | ErrorAutoFixer (autofix.ts) |
|---|---|---|
| Task tracking (TaskItem + taskId) | ❌ No task created | ✅ TaskItem with UUID |
| Git branching / committing | ❌ No git at all | ✅ CommitQueue, git safety |
| Event bus emissions | ❌ None | ✅ task_started, task_completed, task_failed |
| WS overlay events | ❌ None | ✅ autofix_start, autofix_end, autofix_failed, autofix_retry_N |
| Retry logic | ❌ One-shot | ✅ Up to 3 attempts with Next.js cache clearing |
| Lane routing (Lane 2/3/5) | ❌ Direct LLM call | ✅ Lane 2 (single file), Lane 3 (multi-file), Lane 5 (mission) |
| Lane 5 mission execution | ❌ Never | ✅ For complex errors (route conflicts, >3 files, etc.) |
| Project map context | ❌ None | ✅ fileContexts.keys(), route conflict detection |
| Path guard safety | ❌ None | ✅ PathGuard checks |
| Deletion intent detection | ❌ None | ✅ DELETION_INTENT_KEYWORDS → DELETE instructions |
| Error classification | ❌ Basic (just passes raw error) | ✅ IMAGE_PATTERNS vs ERROR_PATTERNS |
| Cooldown / dedup | ❌ None | ✅ 60s cooldown, same-error dedup, budget exhaustion |
| Safety timeout | ❌ None | ✅ 5-minute safety timeout |
| Post-fix validation (tsc/health) | ❌ None | ✅ Post-task health check |
| Max tokens | 4096 (hardcoded) | Configurable per lane |

### The Installer.ts "AI fix" path has identical limitations.

---

## 5. All "Describe what to fix" Strings Across CLI

| File | Line context | Exact prompt string |
|---|---|---|
| `packages/cli/src/commands/start.ts` | `recoverDevServer`, line ~500 | `input({ message: 'Describe what to fix:' })` |
| `packages/cli/src/boot/Installer.ts` | choice label, line ~100 | `chalk.dim('Describe what to fix (AI will handle it)')` |
| `packages/cli/src/boot/Installer.ts` | `handleAiFix`, line ~210 | `input({ message: 'Describe what needs to be fixed:' })` |

No other occurrences found in the codebase.

---

## 6. Lane 5 / Autofix Integration Opportunities

### Current State

The **ErrorAutoFixer** (`packages/cli/src/autofix.ts`) already has full Lane 5 integration:

```ts
constructor(
  // ...
  private readonly lane5Executor?: Lane5Executor,   // Optional
  private readonly missionConfig?: MissionConfig,   // Optional
)
```

It routes complex errors to Lane 5 via `shouldUseLane5()`:
- Route conflicts (`both match path`)
- Duplicate/conflicting keywords (DELETION_INTENT_KEYWORDS)
- High file count (>3 project files affected)

When Lane 5 is engaged, it gets:
- **Full task description** with error context (up to 500 chars of error output + deletion intent guidance + retry context)
- **Affected file list** extracted from error output and project map
- **Project map context** (all fileContexts)

The `startCommand` in `start.ts` already wires Lane5Executor into ErrorAutoFixer:
```ts
autoFixer = new ErrorAutoFixer(
  cwd, llmClient, gitManager, eventBus, wsServer, projectMap,
  commitQueue, config.models.micro, undefined, // logger
  lane5Executor,    // ← Lane 5 executor
  missionConfig,    // ← mission config
);
```

And autoFixer is wired to dev server output:
```ts
devServer.onOutput((o: string) => autoFixer?.handleOutput(o));
```

### The Gap

**The `recoverDevServer` "AI fix" path does NOT use ErrorAutoFixer at all.** It is a completely separate code path that:
1. Makes a raw LLM call directly (bypasses all lanes)
2. Has none of the infrastructure (git, events, retry, etc.)
3. Never routes to Lane 5

### Integration Points

1. **`recoverDevServer` in `start.ts`** — could be refactored to use `autoFixer.forceFixNow(errorMsg)` instead of the raw LLM call. The error context (`msg`, `cwd`, `devCommand`, `devPort`) would flow through `attemptAutoFix` → `buildTaskDescription` → `executeCompilationFixCore` → Lane 2/3/5 as appropriate.

2. **`handleAiFix` in `Installer.ts`** — same pattern: could use autoFixer instead of raw LLM. However, install errors are a different domain (package.json fixes, missing deps), so a direct ErrorAutoFixer integration may need a dedicated install-error classification path.

3. **Post-recovery health check** — after `recoverDevServer` retries spawn successfully, the startup health check (4s `setTimeout`) could be invoked to catch any remaining errors and route through autoFixer.

4. **The `llmClient.chat` in recoverDevServer** has `maxTokens: 4096` hardcoded — migrating to autoFixer would give configurable model selection.

### What Would Change

If `recoverDevServer` "AI fix" used `ErrorAutoFixer.forceFixNow()`:
- User would still see the "AI fix" → "Describe what to fix:" → fix flow
- But the LLM call would go through proper lane routing (Lane 2/3/5 based on error complexity)
- Git commits would be created for fixes
- Overlay would receive `autofix_start`/`autofix_end` events
- Fixes would have retry logic and safety timeouts
- The user's description would be incorporated into `taskDescription`
- Project map context would inform the LLM about existing files

---

## Summary

| Component | File | Purpose |
|---|---|---|
| Port conflict prompt | `packages/cli/src/commands/start.ts` (acquirePorts) | Interactive port conflict resolution |
| Dev server recovery | `packages/cli/src/commands/start.ts` (recoverDevServer) | Interactive error recovery with "AI fix" option |
| Startup health check | `packages/cli/src/commands/start.ts` (inline setTimeout) | Automatic error detection 4s after start, routes to autoFixer |
| Install recovery | `packages/cli/src/boot/Installer.ts` (ensureDependencies) | Interactive dependency install recovery with "AI fix" option |
| AutoFixer | `packages/cli/src/autofix.ts` (ErrorAutoFixer) | Debounced error handling, lane routing, retry, git safety |
| Dev server runner | `packages/proxy/src/DevServerRunner.ts` | Spawns dev process, captures output, detects errors |
| Event routing | `packages/cli/src/boot/EventRouter.ts` | Wires WS events → Brain/Executor pipeline, post-task health checks |
| Lane 5 executor | `packages/core/src/executor/Lane5Executor.ts` | Mission-based execution for complex errors |
| Mission orchestrator | `packages/core/src/executor/MissionOrchestrator.ts` | LLM-based task decomposition into features with dependencies |

**Key finding:** The `recoverDevServer` interactive "AI fix" path is a legacy code path that bypasses the entire ErrorAutoFixer and Lane 5 infrastructure. It makes raw LLM calls with limited context (800 chars of error + user description), no git safety, no event tracking, and no lane routing. This is the primary integration gap.
