# Migration Guide: v0.2.x → v1.0.0

This guide helps you upgrade from Novastorm v0.2.x to v1.0.0. Follow each section in order.

## Quick Checklist

- [ ] Update the install command to `@novastorm-ai/cli`
- [ ] Rename `models.fast` → `models.standard` in your config
- [ ] Review the new security defaults (localhost bind, per-session token)
- [ ] Remove references to removed commands (`chat`, `tasks`, `watch`, `review`)
- [ ] Accept the telemetry opt-in prompt on first run
- [ ] Run `nova doctor` to verify your setup

---

## Breaking Changes

### 1. Package Renamed

The npm package has been renamed from `nova-architect` to `@novastorm-ai/cli`.

```bash
# Old
npm install -g nova-architect

# New
npm install -g @novastorm-ai/cli
```

### 2. Removed Commands

The following stub commands have been removed in v1.0.0:

| Removed command | Replacement |
|----------------|-------------|
| `nova chat` | Built into the main `nova` command — use the overlay input bar |
| `nova tasks` | Task management is now integrated into the overlay TaskPanel |
| `nova watch` | Auto-fix is now automatic and configurable via `[behavior]` |
| `nova review` | Use `nova doctor` for setup checks |

Running any of these commands will print a deprecation hint and exit with code 2.

### 3. Model Tier Rename: `models.fast` → `models.standard`

The `fast` model tier has been renamed to `standard`.

```toml
# Old (v0.2.x)
[models]
fast = "claude-sonnet-4-6"
strong = "claude-opus-4-6"

# New (v1.0.0)
[models]
micro = "claude-haiku-4-5-20251001"     # new tier for simple tasks
standard = "claude-sonnet-4-6"          # was "fast"
strong = "claude-opus-4-6"              # unchanged
```

The `models.fast` key still works as a deprecated alias — Nova migrates the value
to `models.standard` on first read and prints a one-time warning. This alias will be
**removed in v2.0**.

### 4. Default Host Binding: `0.0.0.0` → `127.0.0.1`

By default, Nova's proxy now binds to `127.0.0.1` (localhost) only. It is no longer
accessible from other devices on your network.

```bash
# To restore the old behavior (accessible from LAN):
nova --host 0.0.0.0
```

### 5. Telemetry: Now Requires Explicit Opt-In

Telemetry is no longer enabled by default. On first run, Nova prompts:

> "Help improve Nova by sharing anonymous usage telemetry? [y/N]"

The default answer is **no**. You can also control telemetry via:

```toml
[telemetry]
enabled = false
```

Or with the `--no-telemetry` flag or `NOVA_TELEMETRY=false` env var.

### 6. Task Confirmation: Default Changed

Tasks now require explicit confirmation before executing. The old auto-execute
behavior can be restored:

```toml
[behavior]
confirmTasks = false    # auto-execute without confirmation
```

Or use the `--yes` flag:

```bash
nova --yes
```

### 7. Config Schema: `[providers]` → `[apiKeys]`

The legacy `[providers]` config block has been migrated to `[apiKeys]`.

```toml
# Old (v0.2.x)
[providers]
deepseek_key = "sk-..."

# New (v1.0.0)
[apiKeys]
deepseek = "sk-..."
```

Old `[providers]` blocks are auto-migrated on first read with a one-time INFO log.

---

## New Features

### `nova doctor`

Diagnose your setup:

```bash
nova doctor
```

Checks: provider connectivity, port availability, Node version, Git availability,
`.nova/` writability, Claude CLI presence (if configured), Ollama reachability
(if configured), package version currency.

### New CLI Flags

| Flag | Description |
|------|-------------|
| `--no-open` | Don't open the browser on startup |
| `--yes` | Auto-confirm all prompts |
| `--port <N>` | Set Nova's port |
| `--proxy-port <N>` | Set the proxy port |
| `--no-telemetry` | Disable telemetry for this run |
| `--host <addr>` | Bind to a specific address (default `127.0.0.1`) |

### New Environment Variables

| Variable | Effect |
|----------|--------|
| `NOVA_NON_INTERACTIVE=1` | Skip all interactive prompts |
| `NOVA_QUIET=1` | Suppress the ASCII banner |
| `NO_COLOR=1` | Disable colored output |
| `NOVA_TELEMETRY=false` | Disable telemetry |

### DeepSeek Provider

[DeepSeek](https://platform.deepseek.com/api_keys) is now a first-class provider:

```bash
nova setup    # select "deepseek" from the provider list
```

Run `nova doctor` after configuring to verify the connection.

---

## Security Improvements

- **Proxy binds to 127.0.0.1 by default** — no LAN exposure unless you opt in with `--host`.
- **Per-session WebSocket token** — generated on each startup, written to `.nova/session-token`.
- **Origin header check** — WebSocket connections are rejected from non-local origins.
- **Dev server commands** — no longer executed via shell (`shell: false`), preventing
  command injection from `[devServer] command`.
- **PathGuard correctness** — fixed a bug where `src/**/*.ts` allowed writes to
  `src/secret.env` and `lib/index.ts`. Now uses `picomatch` consistently.
- **Secret redaction** — API keys are redacted from logs even in `--debug` mode.
- **Protected branch safety** — Nova refuses to commit directly to `main`/`master`
  unless `[git] allowProtectedBranchCommits = true`.

---

## Config Migration Example

Before (v0.2.x `.nova/config.toml`):

```toml
[providers]
deepseek_key = "sk-old-key"

[models]
fast = "claude-haiku-4-5-20251001"
strong = "claude-sonnet-4-6"
```

After (v1.0.0 `.nova/config.toml`):

```toml
[apiKeys]
deepseek = "sk-new-key"

[models]
micro = "claude-haiku-4-5-20251001"
standard = "claude-sonnet-4-6"
strong = "claude-opus-4-6"

[telemetry]
enabled = false
```

> The old `[providers]` block is auto-migrated on first run. You can remove it
> after verifying the migration.

---

## Deprecation Timeline

| Feature | Status | Removal |
|---------|--------|---------|
| `models.fast` alias | Deprecated in v1.0.0 | v2.0 |
| Removed commands (`chat`, `tasks`, `watch`, `review`) | Gone in v1.0.0 | — |
| `[providers]` config block | Auto-migrated in v1.0.0 | v2.0 |
| `lsof \| xargs kill` port killer | Replaced in v1.0.0 | — |
| Shell-based dev server runner | Replaced in v1.0.0 | — |
