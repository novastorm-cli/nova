# Nova Architect — Tips, Tricks & Advanced Features

## Voice & Gesture Power-User Tips

### Iterative Refinement (Append)

You can refine your request **before confirming**:

1. Say: "Add a login form"
2. Tasks appear as pending
3. Say: "Also add Google OAuth button"
4. Nova merges both requests and re-analyzes as one

This works because while tasks are pending, new input gets **appended** to the original request instead of creating a separate one.

### Gesture Mode (Option+G)

Point at elements while speaking for precise targeting:

1. Enable Gesture Mode (Option+G)
2. Start voice (mic button)
3. Point cursor at an element and say "make **this** bigger"
4. Nova correlates your cursor position with the word "this"

**Detected gestures:**
- **Dwell** — hover on an element for 500ms+
- **Path** — move cursor from element A to element B ("move this here")
- **Circle** — draw a circle around a group of elements ("change everything in this area")

**Deictic words** that trigger gesture correlation: "this", "that", "here", "there", "these", "those" (English), "этот", "тут", "здесь", "сюда", "вот" (Russian).

### Voice Languages

Change language without restarting — click the language button in the input bar. 16 languages supported:

Auto, EN, RU, DE, FR, ES, UA, JA, ZH, KO, PT, IT, PL, NL, TR, AR, HI

Language choice persists across reloads.

---

## Quick Edit Tricks

### Rage Click

**3 rapid clicks** on any element opens Quick Edit popup automatically — no need to activate inspector mode first.

### Inspector Popup Persistence

The Quick Edit popup **survives page reloads**. If you're editing an element and the page refreshes (hot reload), the popup reappears in the same position with your text preserved.

### Scoped Edits

Quick Edit instructions are automatically scoped — Nova only modifies the selected element and its children. Sibling elements and unrelated code are untouched. The system wraps your instruction with:

> "SCOPED EDIT — change ONLY the selected element. Do NOT modify sibling elements."

---

## Multi-Edit Patterns

### Effective Multi-Edit Instructions

Mark elements and use relational instructions:

- "Swap 1 and 2"
- "Make 1 look like 3"
- "Align all elements horizontally"
- "Apply the same style as element 2 to elements 1 and 3"
- "Remove elements 2 and 4, keep the rest"

### Click to Unmark

Click a marked element again to remove its number. The remaining elements renumber automatically.

---

## Terminal Chat

### All Commands

| Input | Action |
|-------|--------|
| Any text | Code change request |
| `y` / `yes` / `execute` | Confirm pending tasks |
| `n` / `no` / `cancel` | Cancel pending tasks |
| `revert` / `undo` | Revert last commit |
| `/status` | Stack, port, connected clients, AI model, pending tasks |
| `/settings` | View all config |
| `/settings models.fast gpt-4o` | Change setting (applied immediately) |
| `/map` | Open project map in browser |
| `/help` | Show commands |

### Revert in Any Language

Nova understands revert commands in English and Russian:
- English: `revert`, `undo`, `rollback`
- Russian: `откати`, `верни`, `верни назад`, `отмени последнее`

Revert creates an **inverse commit** (safe, preserves history). You can revert multiple times.

### Hot Settings

Settings changed via `/settings` apply **instantly** — no restart needed:

```
/settings apiKeys.provider anthropic
/settings apiKeys.key sk-ant-...
/settings models.fast claude-haiku-4-5-20251001
/settings behavior.autoCommit true
/settings voice.engine whisper
```

Secret fields (like `apiKeys.key`) are saved to `.nova/config.toml` (gitignored). Public fields go to `nova.toml`.

---

## Custom AI Prompts

### Override Default Prompts

Create files in `.nova/agents/` to customize how Nova generates code:

| File | Controls |
|------|----------|
| `.nova/agents/developer.md` | Code generation prompt (Lane 3/4) |
| `.nova/agents/fixer.md` | Error fix prompt |

**Example** `.nova/agents/developer.md`:
```markdown
You are a code generator for a medical application.
All code must follow HIPAA compliance patterns.
Always use parameterized queries for database access.
Never log PII (personally identifiable information).
Use the existing AuthContext for all protected routes.

OUTPUT FORMAT — use the appropriate wrapper for each file:
=== FILE: path/to/file.tsx ===
full file content
=== END FILE ===
```

This replaces the default system prompt entirely. Keep the output format instructions or code parsing will break.

---

## Lane System Deep Dive

### How Tasks Get Routed

| Lane | When | Speed | Model |
|------|------|-------|-------|
| **1** | CSS-only: colors, fonts, margins, padding, opacity | Instant (regex) | None |
| **2** | Single-file code change | Fast | Fast model |
| **3** | Multi-file, new components, API endpoints | Medium | Fast model |
| **4** | Refactoring, migrations, redesigns | Slow | Strong model |

**Keywords that trigger Lane 4:** refactor, migrate, rewrite, redesign, restructure, upgrade.

**Keywords that trigger Lane 3:** "add page", "new endpoint", "create component", or any multi-file task.

**Lane 1 stays fast** by using regex replacement — no AI call needed. But it only works for simple property changes on existing CSS. If it fails, it automatically falls back to Lane 3.

### Validation Loop

Lane 3/4 tasks go through up to **3 fix iterations**:

1. Generate code
2. Run TypeScript check (`tsc --noEmit`)
3. Verify imports exist in `package.json`
4. If errors → send to CodeFixer → regenerate → repeat
5. After 3 attempts, commit with warnings

**Small changes skip validation** — single-file changes under 3KB are committed directly.

---

## Auto-Fix System

### What Triggers Auto-Fix

Nova watches the dev server output for these patterns:
- `Module not found`
- `SyntaxError`
- `TypeError`
- `Build error` / `Failed to compile`
- `Error boundary`
- Next.js image errors (hostname not configured, invalid src)

### How It Works

1. Error detected in dev server logs
2. **2-second debounce** — waits for more errors to batch
3. Creates fix task (image fixes or general compilation fixes)
4. Overlay shows: "Fixing build errors... please wait"
5. Fix applied, page reloads automatically

### Post-Task Health Check

After **every** completed task, Nova:
1. Waits 3 seconds for hot reload to settle
2. Scans last 2000 lines of dev server logs
3. Makes HTTP GET to dev server
4. If HTTP 500+ → triggers immediate auto-fix
5. If build errors → creates fix task

### Startup Health Check

4 seconds after overlay connects:
- Scans dev server logs for existing build errors
- If found, shows pending fix task for confirmation

---

## Environment Variables & Secrets

### Automatic Detection

When Nova generates code containing `process.env.DATABASE_URL`, it:

1. Checks if `DATABASE_URL` exists in `.env.local`
2. If missing → shows SecretConsole in overlay
3. You enter the value
4. Saved to `.env.local`, auto-added to `.gitignore`

### Excluded from Detection

These are **not** prompted (considered system vars):
`NODE_ENV`, `PORT`, `CI`, `HOME`, `PATH`, `PWD`, `SHELL`, `USER`, `LANG`, `TERM`, `HOSTNAME`, `TMPDIR`, `TZ`

Also excluded: anything starting with `NEXT_PUBLIC_` (public, not secret).

---

## Stack Detection

### Supported Frameworks

| Framework | Detection | Dev Command | Default Port |
|-----------|-----------|-------------|------|
| Next.js | `next` in deps | `npm run dev` | 3000 |
| Nuxt | `nuxt` in deps | `npm run dev` | 3000 |
| SvelteKit | `@sveltejs/kit` in deps | `npm run dev` | 5173 |
| Astro | `astro` in deps | `npm run dev` | 4321 |
| Vite | `vite` in deps | `npm run dev` | 5173 |
| CRA | `react-scripts` in deps | `npm start` | 3000 |
| Django | `manage.py` | `python manage.py runserver` | 8000 |
| FastAPI | `fastapi` in requirements | `uvicorn main:app --reload` | 8000 |
| .NET | `*.csproj` | from `launchSettings.json` | auto |
| Go | `go.mod` | `go run .` | auto |
| Rust | `Cargo.toml` | `cargo run` | auto |

### Package Manager Detection

Priority order:
1. `bun.lockb` / `bun.lock` → **bun**
2. `pnpm-lock.yaml` → **pnpm**
3. `yarn.lock` → **yarn**
4. Default → **npm**

---

## Project Map (Option+M)

Opens `/nova-project-map` in a new browser tab. Shows:
- All services (frontend, backend, workers)
- Routes and pages
- Components
- API endpoints
- Data models with fields
- Dependency graph

---

## RAG (Semantic Code Search)

### How It Works

Nova builds a semantic index of your codebase:

1. **Chunking** — splits files into functions, classes, blocks
2. **Embedding** — generates vector representations
3. **Search** — finds relevant code snippets for each task

### Embedding Providers (auto-detected)

| Priority | Provider | Requirement |
|----------|----------|-------------|
| 1 | **Ollama** | Running at `localhost:11434` |
| 2 | **OpenAI** | `OPENAI_API_KEY` set |
| 3 | **TF-IDF** | Always available (offline) |

Ollama is preferred — free, local, private. Install with `brew install ollama && ollama serve`.

### Index Storage

- Embeddings: `.nova/embeddings.json`
- Dependency graph: `.nova/graph.json`
- Full re-index on startup, incremental updates during session

---

## Project Manifest

### Define Architecture

Create `.nova/manifest.toml` to tell Nova about your project structure:

```bash
nova entity add
```

Interactive prompts for:

**Services:**
```toml
[[services]]
name = "api"
role = "backend"
path = "packages/api"
framework = "express"
language = "typescript"
```

**Databases:**
```toml
[[databases]]
name = "main"
engine = "postgresql"
connectionEnvVar = "DATABASE_URL"
schemaPath = "prisma/schema.prisma"
```

**Boundaries:**
```toml
[boundaries]
writable = ["src", "app", "components"]
readonly = ["lib/legacy"]
ignored = ["vendor", "generated"]
```

This helps Nova understand where to create files, what's off-limits, and how services connect.

---

## Git Workflow Tips

### Safe Experimentation

Nova works on a separate branch (`nova-run-XXXXXXXX`). Your original branch is untouched. When satisfied:

```bash
git checkout main
git merge nova-run-XXXXXXXX
```

### Multiple Reverts

Each `revert` creates an inverse commit. You can revert multiple times to undo several changes:

```
> undo        # reverts task 3
> undo        # reverts task 2
> undo        # reverts task 1
```

### View Changes

```bash
nova status   # shows recent commits
git log --oneline nova-run-*  # see all nova commits
git diff main..HEAD            # see all changes
```

---

## Performance Tips

### Use Lane 1 for Quick CSS

Simple style changes like "make the title red" or "increase padding" use Lane 1 (regex) — instant, no AI call. Keep CSS instructions simple and single-property for fastest results.

### Batch with Multi-Edit

Instead of 5 separate Quick Edits, use Multi-Edit (Option+K) to mark all 5 elements and give one instruction. Nova processes them as a single task.

### Use Strong Model Wisely

Lane 4 (strong model) activates for keywords: refactor, migrate, rewrite, redesign. These tasks take longer but produce better results for complex changes. For simple additions, avoid these keywords.

### Ollama for Privacy & Speed

Run a local model with Ollama — no API calls, no token costs, works offline:

```bash
ollama serve
nova setup -p ollama
```

---

## Troubleshooting

### "AI is thinking..." stuck

- Check terminal for errors
- Try `/status` in terminal
- If LLM is unresponsive, press Ctrl+C and restart

### Overlay disappeared

Nova auto-recovers. If the overlay is removed (e.g., React error boundary), it remounts within seconds. If still missing, reload the page.

### Voice not recognizing

- Chrome recommended (best Web Speech API support)
- Check mic permissions in browser
- Try switching language
- Use text input as fallback

### Auto-fix loops

Nova limits auto-fix to **3 iterations** per task and uses a **5-minute safety timeout**. If fixes keep failing:
1. Type `undo` to revert
2. Give a more specific instruction
3. Check terminal logs for error details

### Diff apply failed

When a diff doesn't apply cleanly, Nova:
1. Tries **fuzzy matching** (ignoring context lines)
2. If still fails, requests **full file content** from AI
3. If that fails too, reports the error

### Port already in use

Nova starts the proxy on `devPort + 1`. If port 3001 is busy, change your dev port:
```
/settings project.port 3002
```
