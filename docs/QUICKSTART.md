# Novastorm — Quick Start

## 1. Install

```bash
npm install -g @novastorm-ai/cli
```

## 2. Setup AI Provider

```bash
nova setup
```

Choose one:
- **Claude CLI** — free if you have Claude Max/Pro subscription
- **OpenRouter** — cheapest pay-per-token option
- **Ollama** — completely free, runs locally
- **DeepSeek** — cost-effective OpenAI-compatible provider

### Model Tiers

Nova uses three model tiers to balance speed, cost, and quality:

| Tier | Used for | Config field |
|------|----------|--------------|
| **micro** | CSS tweaks, simple text changes | `models.micro` |
| **standard** | Single-file edits, new components | `models.standard` |
| **strong** | Refactoring, migrations, complex changes | `models.strong` |

> **Note:** `models.fast` was renamed to `models.standard` in v1.0.0. The old name still works
> as a deprecated alias but will be removed in v2.0.

## 3. Verify Your Setup

```bash
nova doctor
```

Checks your provider connection, Node version, Git, port availability, and `.nova/` writability.
Prints a green checklist when everything is healthy. Fix any `[FAIL]` items before proceeding.

## 4. Start

### Existing Project

```bash
cd my-project
nova
```

Nova auto-detects your stack, starts dev server, opens browser.

### New Project

```bash
mkdir my-app && cd my-app
nova
```

Nova offers templates:
- Next.js + TypeScript
- Vite + React
- Vue, Svelte, Astro, Nuxt
- Express, Django, FastAPI, .NET
- Any combo: "Next.js + C# .NET"

## 5. Build

The browser opens with your app + Nova overlay.

**Type a command:** Click the input bar at the bottom, type `add a login form`, press Enter.

**Voice:** Click the mic button, speak your instruction, click mic again to stop.

**Quick Edit:** Press Option+I, click any element, type what to change.

**Multi-Edit:** Press Option+K, click multiple elements, type instruction for all.

## 6. Confirm & Done

Nova shows tasks → confirm with "Execute" button or press Y in terminal → code changes → page reloads.

---

## CLI Flags

Nova supports flags for headless and CI environments:

```bash
# CI / headless usage
NOVA_NON_INTERACTIVE=1 nova --no-open --no-telemetry --yes
```

| Flag | Effect |
|------|--------|
| `--no-open` | Don't open browser on startup |
| `--yes` | Skip all prompts, use defaults |
| `--port <N>` | Dev server port |
| `--proxy-port <N>` | Proxy server port |
| `--host <addr>` | Proxy bind address (default: `127.0.0.1`) |
| `--no-telemetry` | Disable telemetry |

## Cheat Sheet

| Action | How |
|--------|-----|
| Give instruction | Type in input bar + Enter |
| Voice command | Mic button → speak → mic button |
| Edit one element | Option+I → click → type → Enter |
| Edit multiple | Option+K → click elements → type → Enter |
| Confirm tasks | Y in terminal or Execute button |
| Cancel tasks | N in terminal or Cancel button |
| Undo last change | Type `undo` in terminal |
| Check status | `/status` in terminal |
| Change settings | `/settings models.standard gpt-4o` |
| Open project map | Option+M |

---

## Next Steps

- [User Guide](USER_GUIDE.md) — full feature reference
- [Tips & Tricks](TIPS_AND_TRICKS.md) — advanced features
- [Examples](EXAMPLES.md) — recipes and patterns
- [Configuration](CONFIGURATION.md) — all config options
