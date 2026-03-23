# Nova Architect — Architecture Guide

## System Overview

```
Browser (Overlay)          CLI (Terminal)           Core (Engine)
┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ OverlayPill     │    │ start command    │    │ Brain            │
│ TranscriptBar   │◄──►│ chat REPL        │◄──►│ PromptBuilder    │
│ ElementInspector│ WS │ autofix watcher  │    │ LaneClassifier   │
│ MultiSelector   │    │ health checker   │    │ ExecutorPool     │
│ TaskPanel       │    │ settings manager │    │ CodeValidator    │
│ VoiceCapture    │    └──────────────────┘    │ CodeFixer        │
│ GestureRecognizer│          ▲                │ ProjectIndexer   │
│ CursorTracker   │          │                │ RagIndexer       │
│ ConsoleCapture  │          │                │ GitManager       │
└─────────────────┘    ┌─────┴──────────┐     │ LLM Providers    │
                       │ Proxy Server   │     └──────────────────┘
                       │ (HTTP + WS)    │
                       └────────────────┘
```

## Packages

| Package | Role | Platform |
|---------|------|----------|
| `@novastorm-ai/cli` | Commands, orchestration, terminal chat | Node.js |
| `@novastorm-ai/core` | AI pipeline, indexing, execution, git | Node.js |
| `@novastorm-ai/overlay` | Browser UI, capture, voice, gestures | Browser (IIFE) |
| `@novastorm-ai/proxy` | HTTP proxy + WebSocket server | Node.js |
| `@novastorm-ai/licensing` | License validation, telemetry | Node.js |

---

## Pipeline: From Instruction to Code

### Phase 1: Capture (Overlay)

```
User action (voice/click/type)
    │
    ▼
┌─────────────────────────┐
│ ScreenshotCapture       │ → PNG of viewport
│ DomCapture              │ → HTML of clicked element
│ VoiceCapture            │ → Speech-to-text transcript
│ ConsoleCapture          │ → Recent console errors
│ CursorTracker           │ → Cursor position trail
│ GestureRecognizer       │ → Circle / Path / Dwell gestures
│ TemporalCorrelator      │ → Voice + gesture alignment
└─────────────────────────┘
    │
    ▼
BrowserObservation (JSON over WebSocket)
```

### Phase 2: Analysis (Brain)

```
Observation + ProjectMap
    │
    ▼
PromptBuilder.buildAnalysisPrompt()
    │
    ├── System: JSON-only task decomposition rules
    ├── Screenshot (vision)
    ├── Transcript
    ├── DOM snapshot
    ├── Gesture context
    ├── Service architecture
    ├── Compressed project context
    │     ├── Stack info
    │     ├── Structure (files, routes, components, endpoints)
    │     ├── Key routes (top 20)
    │     ├── Key components (top 20)
    │     ├── Key endpoints
    │     ├── Data models
    │     └── Installed packages
    └── RAG snippets (relevant code)
    │
    ▼
LLM (vision-capable)
    │
    ▼
Option A: [{"description":"...", "files":[...], "type":"..."}]
Option B: [{"question":"Clarifying question?"}]
```

### Phase 3: Classification (LaneClassifier)

```
Task description + files
    │
    ▼
┌────────────────────────────────────────┐
│ refactor/migrate/rewrite    → Lane 4   │
│ add page/create component   → Lane 3   │
│ multi-file                  → Lane 3   │
│ CSS-only + single file      → Lane 1   │
│ everything else             → Lane 2   │
└────────────────────────────────────────┘
```

### Phase 4: Execution (ExecutorPool)

```
Lane 1 (CSS Regex)          Lane 2 (Diff)           Lane 3/4 (LLM)
┌──────────────┐       ┌──────────────┐       ┌──────────────────────┐
│ Parse props  │       │ Send to LLM  │       │ Build prompt         │
│ Find in CSS  │       │ Get diff     │       │ Stream from LLM      │
│ Regex replace│       │ Apply diff   │       │ Parse FILE+DIFF      │
│ Write file   │       │ Write file   │       │ Apply blocks         │
└──────┬───────┘       └──────┬───────┘       │ ┌──────────────────┐ │
       │                      │               │ │ Validation Loop  │ │
       │                      │               │ │ tsc --noEmit     │ │
       │ fail?                │ fail?         │ │ import check     │ │
       │   ↓                  │   ↓           │ │ CodeFixer (x3)   │ │
       │ Lane 3 (fast)        │ Lane 3 (fast) │ └──────────────────┘ │
       │                      │               │ Env var detection    │
       ▼                      ▼               └──────────┬───────────┘
                                                         │
                              ▼                          ▼
                    ┌──────────────────┐
                    │ GitManager       │
                    │ git add + commit │
                    │ "nova: <task>"   │
                    └──────────────────┘
```

### Phase 5: Post-Execution

```
Commit created
    │
    ├── Emit task_completed event → Overlay updates
    ├── Wait 3 seconds
    ├── Health check (scan logs + HTTP ping)
    │     └── errors? → Auto-fix → new task
    └── Page hot-reloads
```

---

## WebSocket Protocol

### Overlay → Server

| Type | Data | When |
|------|------|------|
| `observation` | screenshot, DOM, transcript, URL, errors, gestures | User gives instruction |
| `confirm` | — | User confirms pending tasks |
| `cancel` | — | User cancels pending tasks |
| `append` | `{ text }` | User adds to pending request |
| `browser_error` | `{ error }` | Console error detected |
| `secrets_submit` | `{ secrets: Record<string, string> }` | User enters env vars |

### Server → Overlay

| Type | Data | When |
|------|------|------|
| `status` | `{ message }` | Progress updates |
| `task_created` | `{ id, description, lane }` | Task identified |
| `task_started` | `{ taskId }` | Execution begins |
| `task_completed` | `{ taskId, diff, commitHash }` | Task done |
| `task_failed` | `{ taskId, error }` | Task error |
| `llm_chunk` | `{ text, phase, taskId }` | Streaming LLM output |
| `secrets_required` | `{ envVars[], taskId }` | Missing env vars |
| `analysis_complete` | `{ fileCount, methodCount }` | Indexing done |

### Special Status Messages

| Message prefix | Meaning |
|----------------|---------|
| `question:` | AI asking clarifying question |
| `Pending:` | Tasks ready for confirmation |
| `autofix_start` | Build fix in progress |
| `autofix_end` | Build fix complete |
| `autofix_failed` | Build fix failed |

---

## Indexing Pipeline

```
Project directory
    │
    ▼
StackDetector → framework, language, pkg manager, dev command, port
    │
    ▼
┌─────────────────────────────────────┐
│ Parallel extraction:                │
│ ├── RouteExtractor → pages, APIs   │
│ ├── ComponentExtractor → UI parts  │
│ └── EndpointExtractor → API routes │
└──────────────────┬──────────────────┘
                   │
                   ▼
ProjectIndexer → dependency graph + file contexts
    │
    ├── Import/export extraction (regex)
    ├── File classification (component/page/api/model/hook/util/config)
    ├── Keyword extraction (identifiers)
    ├── Data model extraction (interfaces/types with fields)
    └── package.json → installed packages
    │
    ▼
ContextDistiller → compressed context string
    │
    ▼
RagIndexer → semantic code search
    ├── CodeChunker → split into logical blocks
    ├── MethodExtractor → function boundaries
    ├── Embedding (Ollama > OpenAI > TF-IDF)
    └── VectorStore → .nova/embeddings.json
```

---

## File Structure

```
.nova/
├── config.toml          # Local secrets (gitignored)
├── manifest.toml        # Project architecture
├── graph.json           # Dependency graph
├── embeddings.json      # RAG vectors
└── agents/
    ├── developer.md     # Custom code generation prompt
    └── fixer.md         # Custom error fix prompt

nova.toml                # Public project config (committed)
.env.local               # Environment secrets (gitignored)
```

---

## Security

### Path Guard

All file writes go through `PathGuard`:
- Rejects paths containing `..`
- Rejects absolute paths
- Ensures writes stay within project root

### Secret Handling

- API keys saved to `.nova/config.toml` (gitignored)
- Project secrets saved to `.env.local` (auto-added to `.gitignore`)
- Generated code uses `process.env.VAR` — never hardcoded values
- Secret fields in `/settings` are masked in display

### Git Safety

- Works on separate branch (never modifies main)
- Revert uses `git revert` (preserves history)
- Respects `.gitignore` when staging files
