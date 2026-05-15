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
- **DeepSeek** — cost-effective OpenAI-compatible provider

### Model Tiers

Nova uses three model tiers to balance speed, cost, and quality:

| Tier | Used for | Config field |
|------|----------|--------------|
| **micro** | CSS tweaks, simple text changes | `models.micro` |
| **standard** | Single-file edits, new components | `models.standard` |
| **strong** | Refactoring, migrations, complex changes | `models.strong` |

> `models.fast` was renamed to `models.standard` in v1.0.0 — still works as a deprecated alias
> until v2.0. See [MIGRATION.md](MIGRATION.md) for upgrade notes.

## Usage

| Action | How |
|--------|-----|
| Give instruction | Type in overlay input bar + Enter |
| Voice command | Mic button → speak → mic button |
| Edit one element | `Option+I` → click → type → Enter |
| Edit multiple | `Option+K` → click elements → type → Enter |
| Confirm tasks | `Y` in terminal or Execute button |
| Undo last change | Type `undo` in terminal |
| Open project map | `Option+M` |
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

### Environment Variables

| Variable | Effect |
|----------|--------|
| `NOVA_NON_INTERACTIVE=1` | Skip all prompts, use defaults (equivalent to `--yes`) |
| `NOVA_QUIET=1` | Suppress the startup banner |
| `NO_COLOR=1` | Disable ANSI color output |
| `NOVA_TELEMETRY=false` | Disable telemetry |

## Security Model

Nova binds to **127.0.0.1 by default** — the proxy is inaccessible from other devices on your
network. A unique per-session token is generated on each startup and embedded in the browser
overlay. WebSocket connections are rejected without this token.

To allow remote access (e.g., testing from a phone or another device), use `--host 0.0.0.0`.
Nova prints a warning when binding to a non-loopback address.

```bash
# Default — local only (safe)
nova

# Allow LAN access (use with caution)
nova --host 0.0.0.0
```

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
