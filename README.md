# Novastorm

**Ambient Development toolkit — development that happens around you while you use your app.**

[![npm](https://img.shields.io/npm/v/@novastorm-ai/cli)](https://www.npmjs.com/package/@novastorm-ai/cli)
[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1-green)](LICENSE.md)

Novastorm observes how you use your application and builds features across the full stack — from UI to database — based on your behavior, voice commands, and visual cues. No IDE switching. No context loss. You stay in your product.

## Quick Start

```bash
# Install
npm install -g @novastorm-ai/cli

# Setup AI provider
nova setup

# Verify your setup
nova doctor

# Start in your project directory
cd my-project
nova
```

Nova auto-detects your stack, starts the dev server, and opens the browser with the overlay.

## The Problem

AI coding tools accelerate one step: turning a description into code. But writing code was never the real bottleneck — it's only 25-35% of the path from idea to production.

Every existing approach requires you to **stop using your product and start describing** what you want.

Novastorm removes that step entirely. You don't describe. You **use**. The system observes and builds.

```
nova bible --read    # Read the Ambient Development manifesto
```

## How It Works

```
You use your app → Nova observes → classifies the task → generates full-stack changes → hot reload
```

Three simultaneous modes:

- **Passive** — watches your behavior, spots patterns, suggests improvements
- **Voice** — speak instructions without leaving your app: *"Add a CSV export button here"*
- **Visual** — click elements, draw areas, point at what needs to change

### Speed Lanes

| Lane | Time | Examples |
|------|------|----------|
| Instant | < 2s | CSS, text, colors, spacing |
| Fast | 10-30s | Single-file changes, new component |
| Thorough | 1-5 min | Multi-file features, new pages + API + DB |
| Mission | 5-30 min | Multi-feature orchestrations, autofix coordination, director-reviewed plans |
| Background | minutes-hours | Refactoring, migrations, optimization |

### Supported Stacks

Novastorm is stack-agnostic. It scans your project and adapts:

- Next.js, React, Vue, Svelte, Astro
- Express, Django, FastAPI, .NET, Rails, Go
- Any combination: *"Next.js + C# backend"* — works

### AI Providers

```bash
nova setup
```

- **Anthropic** — direct Claude API, lowest latency
- **OpenAI** — GPT-4o and other GPT models
- **Claude CLI** — free with Claude Max/Pro subscription
- **OpenRouter** — pay-per-token, access to all models
- **Ollama** — completely free, runs locally
- **DeepSeek** — V4 Pro and Flash models via OpenAI-compatible API

### Model Tiers

Nova uses three model tiers to balance speed, cost, and quality:

| Tier | Used for | Config field |
|------|----------|--------------|
| **micro** | CSS tweaks, simple text changes | `models.micro` |
| **standard** | Single-file edits, new components | `models.standard` |
| **strong** | Refactoring, migrations, complex changes | `models.strong` |

> `models.fast` was renamed to `models.standard` in v1.0.0 — still works as a deprecated alias
> until v2.0. See [MIGRATION.md](MIGRATION.md) for upgrade notes.

### Lane 5: Mission Execution

Lane 5 handles complex, multi-feature tasks via an **orchestrator-worker-director** loop. Instead of
generating code in one shot (Lane 3), the system plans feature sets, implements them in dependency
order, and reviews the results — iterating up to a configurable limit.

**How it works:**

1. **Orchestrator** — analyzes the task with your project context and creates a feature plan
   (ordered by dependencies, with file paths and descriptions)
2. **Worker** — implements each feature using FILE/DIFF/DELETE blocks, validates code (tsc +
   imports), and auto-fixes errors
3. **Director** — reviews all results, returns APPROVED or NEEDS_REVISION with per-feature
   action items. The loop repeats until approved or the iteration limit is hit

**How it differs from Lane 3:**

| Aspect | Lane 3 (Thorough) | Lane 5 (Mission) |
|--------|-------------------|------------------|
| Scope | Single task, one LLM call | Multi-feature plan with dependencies |
| Planning | No explicit plan | Orchestrator builds structured plan |
| Execution | Linear, single pass | Parallel features, dependency ordering |
| Review | None | Director review with revision loop |
| Model | `models.strong` | `models.orchestrator` (defaults to strong) |

**Configuration:**

```toml
# In nova.toml
[models]
orchestrator = "claude-opus-4-6"   # optional — falls back to strong

[mission]
enabled = true          # opt-in: defaults to false
autoApprove = false     # skip confirmation prompt when true (or use --yes)
maxIterations = 5       # max director review rounds (1–20, default 5)
```

When `mission.enabled` is false (or the `[mission]` section is absent), complex errors
fall back to Lane 3.

## Usage

| Action | How |
|--------|-----|
| Give instruction | Type in overlay input bar + Enter |
| Voice command | Mic button → speak → mic button |
| Edit one element | `⌥I` (macOS) / `Alt+I` (Linux) → click → type → Enter |
| Edit multiple | `⌥K` (macOS) / `Alt+K` (Linux) → click elements → type → Enter |
| Confirm tasks | `Y` in terminal or Execute button |
| Undo last change | Type `undo` in terminal |
| Open project map | `⌥M` (macOS) / `Alt+M` (Linux) |
| Gesture mode | `⌥G` (macOS) / `Alt+G` (Linux) |
| Read the manifesto | `nova bible --read` |

## CLI Flags

| Flag | Description |
|------|-------------|
| `--no-open` | Don't open browser on startup (useful for CI/headless) |
| `--yes` | Skip all interactive prompts, use safe defaults |
| `--port <N>` | Override dev server port (default: auto-detected) |
| `--proxy-port <N>` | Override proxy server port (default: dev port + 1) |
| `--host <addr>` | Proxy bind address (default: `127.0.0.1`) |
| `--no-telemetry` | Disable telemetry for this run |
| `--debug` | Enable verbose diagnostic output (also `NOVA_DEBUG=1`) |

### Environment Variables

| Variable | Effect |
|----------|--------|
| `NOVA_NON_INTERACTIVE=1` | Skip all prompts, use defaults (equivalent to `--yes`) |
| `NOVA_QUIET=1` | Suppress the startup banner |
| `NO_COLOR=1` | Disable ANSI color output |
| `NOVA_DEBUG=1` | Enable debug / diagnostic output (equivalent to `--debug`) |
| `NOVA_TELEMETRY=false` | Disable telemetry |

## Security Model

Nova binds to **127.0.0.1 by default** — the proxy is inaccessible from other devices on your
network. A unique **per-session WebSocket token** is generated on each startup and embedded in the
browser overlay. WebSocket connections without this token are rejected. The proxy validates the
`Origin` header to prevent cross-origin access.

All **secrets and API keys are redacted from log output** (even with `--debug`). The proxy uses
a **path guard** with allowlist-based writable patterns to prevent directory traversal. Nova runs
the dev server **without a shell** — no `/bin/sh` in the process tree — and the Claude CLI
provider uses direct API calls instead of shell or temp files.

To allow remote access (e.g., testing from a phone or another device), use `--host 0.0.0.0`.
Nova prints a warning when binding to a non-loopback address.

```bash
# Default — local only (safe)
nova

# Allow LAN access (use with caution)
nova --host 0.0.0.0
```

## Removed Commands

The following commands were removed in v1.0.0. Running them prints a migration message:

- `nova chat` → use `nova` (interactive chat is built into the main command)
- `nova tasks` → use the overlay task panel
- `nova watch` → use `nova start` (file watching is integrated)
- `nova review` → use `nova` for interactive code review

## Platform Support

- **Linux** — fully supported
- **macOS** — fully supported
- **Windows** — use WSL 2 (Windows Subsystem for Linux). Native Windows is not supported.

## Architecture

```
packages/
├── cli/        — Command-line interface (@novastorm-ai/cli)
├── core/       — Project analysis, knowledge graph, task orchestration
├── overlay/    — Browser overlay (transcript bar, visual selection, voice input)
├── proxy/      — HTTP/WebSocket proxy between dev server and browser
└── licensing/  — License validation and developer counting
```

## Quality

- **1587 tests**, 0 failures across 134 test files
- **Core package coverage**: 78% — **Proxy package coverage**: 77%
- **0 ESLint errors** across all production code; TypeScript typecheck clean
- **Prettier** formatting enforced across all packages
- **CI**: GitHub Actions on ubuntu + macos (CLI tests, E2E tests, Playwright)

## Documentation

- [Quick Start](docs/QUICKSTART.md)
- [User Guide](docs/USER_GUIDE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [How It Works](docs/HOW_IT_WORKS.md)
- [Voice Guide](docs/VOICE_GUIDE.md)
- [Multi-Stack Support](docs/MULTI_STACK.md)
- [Examples](docs/EXAMPLES.md)
- [Tips & Tricks](docs/TIPS_AND_TRICKS.md)
- [FAQ](docs/FAQ.md)
- [Migration to v1.0](MIGRATION.md)

## License

Novastorm is source-available under the [Business Source License 1.1](LICENSE.md).

- **Free** for individuals, teams of 3 or fewer developers, open-source projects, students, and evaluation
- **Paid license** required for teams of 4+ on closed-source projects
- **Converts to MIT** on March 20, 2029

See [License FAQ](docs/license-faq.md) for details.

## Links

- [Website](https://cli.novastorm.ai)
- [npm](https://www.npmjs.com/package/@novastorm-ai/cli)
- [GitHub](https://github.com/novastorm-cli/nova)
- [Telegram](https://t.me/novastormcli)
- [X](https://x.com/upranevich)
- [Contact](mailto:contact@novastorm.ai)
