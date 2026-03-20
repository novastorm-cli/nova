# Nova Architect — User Guide

## Quick Start

```bash
# 1. Setup (first time)
nova setup

# 2. Start
nova start
```

Nova detects your stack, starts dev server, opens browser with overlay. You're ready to build.

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `nova start` | Start Nova (default command) |
| `nova init` | Create `nova.toml` config |
| `nova setup` | Interactive first-time setup (AI provider + API key) |
| `nova setup -p <provider> -k <key>` | Non-interactive setup |
| `nova status` | Show project status (stack, port, tasks, index) |
| `nova license status` | Show license info |
| `nova license activate <key>` | Activate license key |
| `nova entity add` | Add service/database/entity to manifest |
| `nova entity list` | List registered entities |
| `nova entity remove <name>` | Remove entity |

**Flags:**
- `--no-telemetry` — disable telemetry for this run
- `--version` — show version
- `--help` — show help

---

## Configuration

### nova.toml (project root)

```toml
[apiKeys]
provider = "openrouter"   # anthropic | openai | ollama | claude-cli
key = "sk-..."

[project]
devCommand = "npm run dev"
port = 3000
frontend = "."              # optional
backends = ["api"]          # optional

[models]
fast = "claude-sonnet-4-6"
strong = "claude-opus-4-6"

[behavior]
autoCommit = false
branchPrefix = "nova/"

[voice]
enabled = true
engine = "web"              # web | whisper
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `NOVA_API_KEY` | Override API key from config |
| `NOVA_LICENSE_KEY` | Set license key |
| `NOVA_TELEMETRY=false` | Disable telemetry |

---

## AI Providers

| Provider | Setup | Cost |
|----------|-------|------|
| **Claude CLI** | Requires Claude Max/Pro subscription | Included in subscription |
| **OpenRouter** | API key | Pay-per-token |
| **Anthropic** | API key | Pay-per-token |
| **OpenAI** | API key | Pay-per-token |
| **Ollama** | Local install | Free |

---

## Overlay UI

After `nova start`, the browser overlay appears with these elements:

### Star Button (bottom-right)

Floating button showing current status:
- **Gray** — idle
- **Green** — listening
- **Blue** — processing
- **Red** — error

Click to open menu:
- **Quick Edit** (Option+I) — click any element to edit it
- **Multi-Edit** (Option+K) — mark multiple elements, edit together
- **Project Map** (Option+M) — open project structure visualization
- **Gesture Mode** (Option+G) — point at elements while speaking

Drag to reposition.

### Input Bar (bottom-center)

- **Mic button** (left) — toggle voice recording
- **Text field** — type commands manually
- **Send button** (right) — submit command
- **Language button** — change voice language

Supported languages: Auto, EN, RU, DE, FR, ES, UA, JA, ZH, KO, PT, IT, PL, NL, TR, AR, HI.

### Quick Edit (Option+I)

1. Press Option+I or select from star menu
2. Click any element on the page
3. Type instruction in popup (e.g. "make it bold", "change color to red")
4. Press Enter — executes immediately, no confirmation needed

Also activates on **3 rapid clicks** (rage click) on the same element.

### Multi-Edit (Option+K)

1. Press Option+K or select from star menu
2. Click elements to mark them (numbered badges appear)
3. Click marked element again to unmark
4. Type instruction in bottom panel for all marked elements
5. Submit — executes immediately

### Task Panel (top-right)

Shows tasks as they're created and executed:
- Pending → Executing → Completed / Failed
- Lane indicator (1 = simple, 2 = standard, 3 = complex)
- Auto-hides after 5 seconds of inactivity

### Activity Log (bottom-left)

Chronological log of all Nova actions. Click title to collapse/expand.

### Secret Console

Appears when generated code uses `process.env.VARIABLE_NAME` for a variable that doesn't exist in `.env.local`. Enter the value — it's saved to `.env.local` and auto-added to `.gitignore`. Press Escape to skip.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Option+I** | Toggle Quick Edit |
| **Option+K** | Toggle Multi-Edit |
| **Option+M** | Open Project Map |
| **Option+G** | Toggle Gesture Mode |
| **Escape** | Deactivate current mode |
| **Enter** (in input bar) | Submit command |

In terminal:

| Key | Action |
|-----|--------|
| **Y** / **Enter** | Confirm pending tasks |
| **N** | Cancel pending tasks |
| **Ctrl+C** | Shutdown Nova |

---

## How It Works

### 1. You give an instruction

Type in the input bar, speak via microphone, or use Quick Edit / Multi-Edit on specific elements.

### 2. Nova captures context

Screenshot of the page, DOM snapshot of clicked element, your transcript, current URL, console errors.

### 3. AI analyzes

The AI decomposes your request into tasks. If something is unclear or a dependency is missing (e.g. no database configured), it asks a clarifying question.

### 4. Confirmation

- **Voice commands** — require confirmation ("N task(s) ready. Execute?")
- **Quick Edit / Multi-Edit** — auto-execute immediately
- **Text commands** — require confirmation

### 5. Code generation

Tasks execute in parallel across lanes:
- **Lane 1** — CSS/style changes (regex-based, instant)
- **Lane 2** — single-file edits (diff-based)
- **Lane 3** — multi-file changes (full LLM generation)
- **Lane 4** — complex refactoring (uses stronger model)

### 6. Validation & auto-fix

Generated code is validated (TypeScript, ESLint). If errors found, Nova auto-fixes (up to 3 iterations).

### 7. Git commit

Changes committed to a `nova-run-XXXXXXXX` branch. Each task = separate commit. Revert with "undo" / "revert" command.

### 8. Hot reload

Page reloads automatically to show changes.

---

## Auto-Fix

Nova monitors the dev server for build errors:
- Module not found
- Syntax errors
- Type errors
- Image configuration issues
- Build failures

When detected, Nova automatically creates a fix task, applies the fix, and reloads the page. Status shown in overlay: "Fixing build errors... please wait".

---

## Gesture Mode

Toggle with **Option+G**. When enabled:

1. Start voice recording (click mic)
2. Point cursor at the element you're talking about
3. Speak your instruction ("make *this* button bigger")
4. Nova correlates your cursor position with your words

Improves accuracy when referring to specific elements by pointing.

---

## Project Manifest (.nova/manifest.toml)

Define your project architecture for better AI understanding:

```bash
nova entity add
```

**Service types:** frontend, backend, worker, gateway
**Database engines:** postgresql, mysql, sqlite, mongodb, redis
**Entity types:** module, external-service, library, shared-package

Example:
```toml
[[services]]
name = "web"
role = "frontend"
path = "."
framework = "next.js"

[[databases]]
name = "main-db"
engine = "postgresql"
connectionEnvVar = "DATABASE_URL"
```

---

## Terminal Chat Commands

When Nova is running, the terminal accepts:

| Input | Action |
|-------|--------|
| Any text | Send as code change request |
| `/help` | Show help |
| `/status` | Show status (stack, port, clients, AI, tasks) |
| `/settings` | View all settings |
| `/settings <key> <value>` | Change setting |
| `/map` | Open project map in browser |

---

## Git Workflow

- Nova creates a branch on startup: `nova-run-XXXXXXXX`
- Each completed task = one commit
- Commit message format: `nova: <task description>`
- Say "revert" / "undo" to revert the last commit
- Your original branch is untouched — merge when satisfied

---

## Licensing

| Tier | Developers | Key Required |
|------|-----------|--------------|
| **Free** | 1-3 | No |
| **Company** | 4+ | Yes |
| **Enterprise** | Unlimited | Yes |

Developer count is determined by unique git authors in the last 90 days (bots excluded).

```bash
nova license status           # Check current status
nova license activate NOVA-XXXXX  # Activate key
```

Or set via environment variable: `NOVA_LICENSE_KEY=NOVA-XXXXX`

---

## Scaffolding

If you run `nova start` in an empty directory, Nova offers templates:

1. **Next.js + TypeScript** — full-stack app
2. **Vite + React + TypeScript** — SPA
3. **Vite + Vue + TypeScript** — Vue app
4. **Astro** — static + dynamic
5. **Other** — describe what you want
6. **Empty** — manual setup

---

## Troubleshooting

**Nova doesn't start:**
- Check `nova.toml` exists (run `nova init`)
- Run `nova setup` to configure AI provider

**AI not responding:**
- Check API key: `nova status`
- Check provider is reachable

**Overlay not visible:**
- Check proxy port (default: dev port + 1)
- Open browser dev tools console for errors

**Build errors loop:**
- Nova auto-fixes up to 3 times, then stops
- Check console for details
- Revert with "undo" command

**Voice not working:**
- Browser must support Web Speech API (Chrome recommended)
- Check microphone permissions
- Try changing language (language button in input bar)
