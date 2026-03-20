# Nova Architect — Configuration Reference

Nova uses three config files with different purposes:

| File | Purpose | Committed to Git |
|------|---------|:---:|
| `nova.toml` | Project settings shared by team | Yes |
| `.nova/config.toml` | Local secrets (API keys) | No (gitignored) |
| `.nova/manifest.toml` | Project architecture & boundaries | Yes |

---

## nova.toml

Main project config. Created by `nova init` or `nova setup`.

### [apiKeys]

```toml
[apiKeys]
provider = "openrouter"    # AI provider
key = "sk-or-..."          # API key (prefer .nova/config.toml for secrets)
```

**Providers:** `claude-cli`, `anthropic`, `openrouter`, `openai`, `ollama`

> Tip: Store the key in `.nova/config.toml` instead to keep it out of git.

### [project]

```toml
[project]
devCommand = "npm run dev"     # Command to start dev server
port = 3000                    # Dev server port
frontend = "."                 # Frontend root directory
backends = ["backend", "api"]  # Backend directories
```

- `devCommand` — auto-detected if not set (from package.json scripts, framework conventions)
- `port` — auto-detected from framework config files if not set
- `frontend` / `backends` — set automatically for multi-stack scaffolds (e.g. "Next.js + .NET")

### [models]

```toml
[models]
fast = "claude-sonnet-4-6"         # Used for Lane 1-3 tasks
strong = "claude-opus-4-6"          # Used for Lane 4 (refactoring)
local = false                       # Prefer local models via Ollama
```

**Model selection by lane:**

| Lane | Task type | Model used |
|------|-----------|------------|
| 1 | CSS/style (regex) | None (no AI call) |
| 2 | Single-file edit | `fast` |
| 3 | Multi-file generation | `fast` |
| 4 | Refactoring | `strong` |

### [behavior]

```toml
[behavior]
autoCommit = false             # Auto-commit without confirmation
branchPrefix = "nova/"         # Git branch prefix
passiveSuggestions = true      # Show non-blocking suggestions
```

### [voice]

```toml
[voice]
enabled = true      # Enable voice input
engine = "web"      # Speech-to-text engine
```

**Engines:**
- `web` — Browser Web Speech API (default, no setup needed, Chrome recommended)
- `whisper` — Local Whisper model via Ollama (requires `ollama serve`)

### [telemetry]

```toml
[telemetry]
enabled = true    # Send anonymous telemetry on startup
```

See [telemetry.md](telemetry.md) for what is collected.

### [license]

```toml
[license]
key = "NOVA-XXXXX-XXXX"    # License key for teams > 3 devs
```

---

## .nova/config.toml

Local config for secrets. Auto-created by `nova setup`. Never committed to git.

```toml
[apiKeys]
provider = "anthropic"
key = "sk-ant-api03-..."
```

Values here **override** `nova.toml`. Use this for API keys so they stay out of git.

---

## .nova/manifest.toml

Defines project architecture, services, databases, and boundaries. Created via `nova entity add`.

### [[services]]

```toml
[[services]]
name = "web"
role = "frontend"          # frontend | backend | worker | gateway
path = "."
framework = "next.js"
language = "typescript"

[[services]]
name = "api"
role = "backend"
path = "backend"
framework = "dotnet"
language = "csharp"
```

### [[databases]]

```toml
[[databases]]
name = "main"
engine = "postgresql"          # postgresql | mysql | sqlite | mongodb | redis
connectionEnvVar = "DATABASE_URL"
schemaPath = "prisma/schema.prisma"
```

### [[entities]]

```toml
[[entities]]
name = "stripe-integration"
type = "external-service"      # module | external-service | library | shared-package
description = "Payment processing via Stripe API"
files = ["lib/stripe.ts", "app/api/webhooks/stripe/route.ts"]
```

### [boundaries]

```toml
[boundaries]
writable = ["src", "app", "components", "lib"]    # Nova can modify
readonly = ["lib/legacy", "vendor"]                 # Nova can read but not modify
ignored = ["generated", ".cache"]                   # Nova skips entirely
```

---

## Environment Variables

Override config via environment:

| Variable | Overrides | Example |
|----------|-----------|---------|
| `NOVA_API_KEY` | `apiKeys.key` | `sk-ant-api03-...` |
| `NOVA_LICENSE_KEY` | `license.key` | `NOVA-XXXXX-XXXX` |
| `NOVA_TELEMETRY` | `telemetry.enabled` | `false` |

---

## Runtime Settings (/settings)

Change settings without restarting Nova:

```
/settings                              # View all settings
/settings apiKeys.provider anthropic   # Change provider
/settings apiKeys.key sk-ant-...       # Change API key (saved to .nova/config.toml)
/settings models.fast gpt-4o           # Change fast model
/settings models.strong claude-opus-4-6 # Change strong model
/settings project.port 3002            # Change port
/settings behavior.autoCommit true     # Enable auto-commit
/settings voice.engine whisper         # Switch to Whisper
```

Secret fields (`apiKeys.key`) are saved to `.nova/config.toml`. Everything else goes to `nova.toml`.

Changes apply immediately — no restart needed.

---

## Custom AI Prompts

Override the default code generation and fix prompts:

| File | Controls |
|------|----------|
| `.nova/agents/developer.md` | Code generation system prompt (Lane 3/4) |
| `.nova/agents/fixer.md` | Error fix system prompt |

These replace the entire default prompt. You must include the output format instructions (`=== FILE ===` / `=== DIFF ===` blocks) or code parsing will break.

See [Tips & Tricks](TIPS_AND_TRICKS.md#custom-agent-prompts) for examples.

---

## File Structure Summary

```
my-project/
├── nova.toml                 # Public config (committed)
├── .nova/
│   ├── config.toml           # Local secrets (gitignored)
│   ├── manifest.toml         # Project architecture
│   ├── graph.json            # Dependency graph (auto-generated)
│   ├── embeddings.json       # RAG vectors (auto-generated)
│   └── agents/
│       ├── developer.md      # Custom code generation prompt
│       └── fixer.md          # Custom error fix prompt
├── .env.local                # Project secrets (gitignored)
└── ...
```
