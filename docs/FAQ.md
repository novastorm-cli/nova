# Nova Architect — FAQ

## General

### What is Nova Architect?

A CLI tool that lets you build web applications by speaking, typing, or clicking elements in the browser. It works with your existing project — no cloud IDE, no platform lock-in.

### What frameworks does it support?

**Frontend:** Next.js, React, Vue, Nuxt, SvelteKit, Astro, Solid, Remix
**Backend:** .NET, Express, Fastify, Hono, Django, FastAPI, Flask, Go
**Detection:** Automatic based on package.json, .csproj, go.mod, requirements.txt, etc.

### Do I need to use a specific IDE?

No. Nova works entirely in the terminal + browser. Use any editor you want — VS Code, WebStorm, Vim, or nothing at all.

### Does it work offline?

Partially. With **Ollama** as your AI provider, everything runs locally. Voice input requires an internet connection (uses browser Web Speech API).

---

## AI & Models

### Which AI provider should I choose?

| Need | Provider | Why |
|------|----------|-----|
| Free, have Claude subscription | **Claude CLI** | Uses your existing subscription |
| Cheapest pay-per-token | **OpenRouter** | Access to all models, best prices |
| Maximum quality | **Anthropic** | Direct Claude API, lowest latency |
| Complete privacy | **Ollama** | Everything local, no data leaves your machine |
| GPT models | **OpenAI** | If you prefer GPT-4 |

### How much does AI cost per task?

Depends on the lane:
- **Lane 1** (CSS change): Free (no AI call)
- **Lane 2** (single file): ~$0.001
- **Lane 3** (multi-file): ~$0.01-0.05
- **Lane 4** (refactoring): ~$0.10-0.50

With Ollama: always free.

### Can I change models mid-session?

Yes: `/settings models.fast gpt-4o` applies immediately.

### Does my code get sent to AI?

Only the relevant files for each task — not your entire codebase. With Ollama, nothing leaves your machine.

---

## Voice

### Which browsers support voice?

Chrome has the best Web Speech API support. Firefox and Safari have limited support. Edge works too.

### Voice isn't working. What do I do?

1. Check microphone permissions in browser settings
2. Use Chrome for best compatibility
3. Try changing the language (click language button in input bar)
4. Fall back to typing — all features work via text too

### Can I use voice in Russian?

Yes. Click the language button and select "RU". 16 languages supported total.

### Is voice mandatory?

No. Every feature works via typed text in the input bar. Voice is optional.

---

## Git & Changes

### Does Nova modify my main branch?

No. Nova creates a separate branch (`nova-run-XXXXXXXX`) for all changes. Your main branch is untouched.

### How do I undo a change?

Type `undo` or `revert` in the terminal. Works in Russian too: `откати`, `верни назад`.

### How do I merge Nova's changes?

```bash
git checkout main
git merge nova-run-XXXXXXXX
```

Or cherry-pick specific commits.

### Does Nova create one big commit or many small ones?

Each task = one commit. "Add login form" with 3 tasks creates 3 separate commits. Easy to revert individually.

---

## Auto-Fix

### My auto-fix seems stuck. What's happening?

Nova limits auto-fix to **3 attempts** for the same error. After that, it stops and shows "autofix_failed". If you see it looping:
1. Type `undo` to revert the problematic change
2. Give a more specific instruction
3. Check terminal logs for the actual error

### Can I disable auto-fix?

Auto-fix runs automatically when build errors are detected. Currently there's no config toggle, but it stops after 3 failed attempts and enters a 1-minute cooldown.

---

## Multi-Stack

### Can I use Next.js + Django together?

Yes. When scaffolding, type "Next.js + Django". Nova creates Next.js in root and Django in `backend/`. See [Multi-Stack Guide](MULTI_STACK.md).

### Nova put files in the wrong directory. Why?

Make sure `nova.toml` has `frontend` and `backends` set:
```toml
[project]
frontend = "."
backends = ["backend"]
```
This tells the AI where to create frontend vs backend files.

### How do I add a database?

When you ask for something that needs a database, Nova will ask which one to use. Or set it up manually:

```bash
nova entity add
# → Choose "Database"
# → Select engine (PostgreSQL, MongoDB, etc.)
# → Enter connection env var name
```

---

## Performance

### Indexing is slow. How to speed it up?

Set `frontend` and `backends` in `nova.toml` so Nova only scans relevant directories.

### How to reduce AI costs?

1. Use Ollama for simple CSS/style changes (Lane 1 doesn't use AI at all)
2. Use a cheaper fast model: `/settings models.fast claude-haiku-4-5-20251001`
3. Use Quick Edit (Option+I) for single-element changes — smaller prompts
4. Batch changes with Multi-Edit instead of many separate requests

### Can I use it on a large project?

Yes. Nova uses RAG (semantic code search) to find relevant code instead of sending your entire codebase. Only files relevant to each task are included in AI prompts.

---

## Licensing

### Is Nova free?

Free for solo developers and teams up to 3 people. See [License FAQ](license-faq.md).

### How are developers counted?

Unique git author emails in the last 90 days. Bots (dependabot, renovate, etc.) are excluded.

### What happens if I exceed 3 developers without a license?

Nova continues to work but shows nudge messages. No hard block.

---

## Troubleshooting

### "No project detected"

Run `nova init` to create a `nova.toml`, or run `nova start` in a directory with a `package.json`.

### Overlay not visible

- Check that the proxy is running (terminal shows "Proxy ready at localhost:3001")
- Open `localhost:3001` (not `localhost:3000`)
- Check browser console for errors

### "Module not found" errors after Nova's changes

Nova auto-fixes these. If it loops, type `undo` and rephrase your instruction.

### Nova created duplicate components

Be specific: "add a LoginForm to the existing header" instead of just "add login form".

### WebSocket disconnected

The overlay auto-reconnects (up to 5 retries). If it fails, reload the browser page.

### "Command failed with exit code 1" during scaffold

Common causes:
- `.next/` or `node_modules/` from a previous attempt (Nova cleans these automatically now)
- No internet connection (scaffolders download dependencies)
- Missing tools: `npx`, `dotnet`, `pip`, `go` — install the ones your stack needs
