# Nova Architect — Quick Start

## 1. Install

```bash
npm install -g nova-architect
```

## 2. Setup AI Provider

```bash
nova setup
```

Choose one:
- **Claude CLI** — free if you have Claude Max/Pro subscription
- **OpenRouter** — cheapest pay-per-token option
- **Ollama** — completely free, runs locally

## 3. Start

### Existing Project

```bash
cd my-project
nova start
```

Nova auto-detects your stack, starts dev server, opens browser.

### New Project

```bash
mkdir my-app && cd my-app
nova start
```

Nova offers templates:
- Next.js + TypeScript
- Vite + React
- Vue, Svelte, Astro, Nuxt
- Express, Django, FastAPI, .NET
- Any combo: "Next.js + C# .NET"

## 4. Build

The browser opens with your app + Nova overlay.

**Type a command:** Click the input bar at the bottom, type `add a login form`, press Enter.

**Voice:** Click the mic button, speak your instruction, click mic again to stop.

**Quick Edit:** Press Option+I, click any element, type what to change.

**Multi-Edit:** Press Option+K, click multiple elements, type instruction for all.

## 5. Confirm & Done

Nova shows tasks → confirm with "Execute" button or press Y in terminal → code changes → page reloads.

---

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
| Change settings | `/settings models.fast gpt-4o` |
| Open project map | Option+M |

---

## Next Steps

- [User Guide](USER_GUIDE.md) — full feature reference
- [Tips & Tricks](TIPS_AND_TRICKS.md) — advanced features
- [Examples](EXAMPLES.md) — recipes and patterns
- [Configuration](CONFIGURATION.md) — all config options
