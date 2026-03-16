# Nova Architect — Codegen from Usage

## Vision

Open-source CLI tool. Ставишь через npm, запускаешь в любом проекте одной командой — получаешь AI-наблюдателя, который смотрит как ты пользуешься приложением и достраивает код.

Как Claude Code, но не просто агент в терминале — штука, которая поднимает твоё приложение, открывает браузер с оверлеем и позволяет разговаривать с проектом голосом и кликами.

---

## Установка и запуск

```bash
npm install -g nova-architect

cd ~/projects/my-app
nova
```

Одна команда. Дальше система сама:
1. Детектит стек (package.json, .csproj, docker-compose.yml, ...)
2. Индексирует проект — граф файлов, роуты, компоненты, API, модели
3. Генерирует сжатое описание проекта (context distillation)
4. Находит и запускает dev-сервер
5. Открывает браузер с оверлеем поверх localhost

Если не смогла автоматически — спрашивает: "Не могу определить команду запуска. Какой командой запустить dev-сервер?"

### Первый запуск — интерактивный setup

```
Welcome to Nova Architect!

No API key found. Choose a provider:
> OpenRouter (recommended — access to all models)
  Anthropic
  OpenAI
  Ollama (free, local)

Paste your API key: sk-...

Detecting project...
  Found: Next.js + TypeScript
  Dev command: npm run dev
  Port: 3000

Starting project... done
Opening browser with overlay... done

Ready! Speak, click, or type to start building.
```

---

## CLI Commands

```bash
nova                # Full mode: index + dev server + browser overlay + voice
nova chat           # Terminal-only mode, like Claude Code. No browser, no overlay.
nova watch          # Passive mode. Observes usage, accumulates suggestions. Changes nothing.
nova tasks          # Show task queue (proposed by AI or queued via voice)
nova review         # Show all changes agents made, for review before merge
nova init           # Create nova.toml config without starting
nova status         # Show project index status, running agents, pending changes
```

---

## Config — `nova.toml`

Created in project root on first run. Committed to repo so team shares settings.

```toml
[project]
dev_command = "npm run dev"
port = 3000

[models]
fast = "openrouter/qwen-2.5-coder-7b"      # lane 1-2
strong = "anthropic/claude-sonnet-4"         # lane 3
local = true                                  # use Ollama for trivial edits

[api_keys]
provider = "openrouter"                       # or: anthropic, openai
# actual key from env: NOVA_API_KEY

[behavior]
auto_commit = false            # commit automatically or wait for review
branch_prefix = "nova/"        # all changes in nova/* branches
passive_suggestions = true     # suggest improvements from usage observation

[voice]
enabled = true
engine = "web"                 # "web" (Web Speech API, free) or "whisper" (local)
```

---

## Tech Stack

### Why TypeScript (not C#/.NET)

For a CLI tool distributed via npm, TypeScript is the right choice:

| Reason | Detail |
|--------|--------|
| **Distribution** | `npm install -g` — one command, works everywhere. No .NET runtime dependency. |
| **Proxy server** | Node.js excels at HTTP proxying (http-proxy, node-http-proxy). C# can do it but it's more friction. |
| **Browser injection** | The overlay is injected JS — sharing types between proxy and overlay is seamless in TS. |
| **Ecosystem** | AST parsers for JS/TS (babel, ts-morph), CSS (postcss), HTML (cheerio) are all native npm packages. |
| **Electron-free** | No Electron needed. Proxy injects a `<script>` tag — works in any browser. Lighter, simpler. |
| **Claude Code model** | Claude Code itself is TypeScript/Node.js CLI — proven approach for this kind of tool. |

C#/.NET remains useful for **indexing C# projects** (Roslyn) — can be an optional sidecar for .NET repos. But the core tool is TypeScript.

### Stack summary

| Component | Technology |
|-----------|-----------|
| CLI core + orchestrator | TypeScript, Node.js |
| Dev server proxy | Node.js http-proxy + HTML injection |
| Browser overlay | Vanilla JS/TS injected via `<script>` tag |
| Project indexer | TypeScript + AST parsers (ts-morph, babel, postcss) |
| File watcher | chokidar |
| Voice → text | Web Speech API (browser, free) or Whisper.cpp (local) |
| Local model | Ollama (optional, for Lane 1) |
| LLM API | OpenRouter / Anthropic / OpenAI — user's choice |
| Config | TOML (via @iarna/toml) |
| Terminal UI | ink (React for CLI) or chalk + ora for simpler approach |

---

## Architecture — Three Processes

```
Process 1: CLI Core (Node.js)
├── Project Indexer      — scans repo, builds dependency graph
├── Lane Classifier      — routes tasks by complexity
├── Brain                — multimodal LLM: screenshot + voice + context → tasks
├── Executor Pool        — applies code changes per lane
├── Task Manager         — queues, priorities, status tracking
├── Git Manager          — branches, commits, rollbacks
└── Terminal UI          — status output, nova chat mode

Process 2: Dev Server Proxy (Node.js)
├── Spawns user's dev server (npm run dev, dotnet run, etc.)
├── Proxies localhost:3000 → localhost:3001
├── Injects overlay <script> into every HTML response
├── WebSocket server for overlay ↔ CLI communication
└── Screenshot endpoint (via Puppeteer or html2canvas in overlay)

Process 3: File Watcher (chokidar)
├── Watches project files for changes
├── On AI edit → triggers hot reload (already happens via dev server)
├── On user edit → incrementally updates project index
└── Debounced to avoid thrashing
```

### Why proxy instead of Electron?

- **Zero install overhead.** No 200MB Electron binary. Just npm package.
- **Any browser.** Works in Chrome, Firefox, Safari — whatever dev already has open.
- **Simpler architecture.** Proxy injects one `<script>` tag. That script adds the overlay UI and captures clicks/voice.
- **Same capabilities.** Screenshots via html2canvas (in-page) or Puppeteer (headless, for higher quality). Click capture via addEventListener. Voice via Web Speech API.
- **Lighter.** Total package size ~50MB vs ~500MB with Electron.

---

## Overlay — Injected Script

The proxy injects a small script (`nova-overlay.js`, ~20KB) into every HTML page. This script:

1. **Renders floating UI** — small pill in corner: mic button, mode indicator, status
2. **Captures clicks** — when in "show" mode, click = select element + open command input
3. **Captures voice** — Web Speech API, continuous listening when mic is active
4. **Takes screenshots** — html2canvas for visible viewport
5. **Reads DOM** — snapshot of clicked element + surrounding structure
6. **Sends to CLI** — via WebSocket to proxy → proxy forwards to CLI core

```
User clicks element in browser
    → overlay captures: screenshot + click coords + DOM snapshot
    → sends via WebSocket to proxy (localhost:3001/ws)
    → proxy forwards to CLI core
    → Brain analyzes with LLM
    → Executor applies changes to files
    → Dev server hot reloads
    → User sees result in browser
```

### Overlay modes

- **Command mode** (default): click or speak to give instructions
- **Passive mode**: overlay is invisible, just observes behavior silently
- **Off**: `nova chat` — no overlay, terminal only

---

## Speed Lanes

| Lane | Target | What | How | Cost |
|------|--------|------|-----|------|
| **1 — Instant** | < 2s | CSS, text, visibility, config | Ollama local model or regex/AST rules. No API call. | Free |
| **2 — Fast** | 10-30s | Single-file: new component, add field, tweak logic | Fast model (Haiku/Flash) + pre-built mini-context | ~$0.001 |
| **3 — Standard** | 1-5min | Multi-file feature: front + back + DB | Strong model (Sonnet/Opus) + full project context. Decomposed. | ~$0.05 |
| **4 — Background** | Minutes-hours | Refactor, migration, large rewrite | Async agent. Works in background. Notifies when done. | ~$0.50 |

### Classifier logic (rule-based, ~1ms)

```
1. Only style/text/visibility keywords + single element → Lane 1
2. Single file scope + matches known pattern → Lane 2
3. Multiple files OR new entity → Lane 3
4. "refactor" / "migrate" / "rewrite" → Lane 4
5. Ambiguous → quick LLM classification (Haiku, ~500ms)
```

---

## Project Indexer

Runs on `nova` startup and incrementally via file watcher.

### What it extracts

```typescript
interface ProjectMap {
  stack: StackInfo;              // "next.js + typescript", "dotnet + react", etc.
  devCommand: string;            // "npm run dev"
  port: number;                  // 3000
  routes: RouteInfo[];           // /dashboard, /settings, /api/users
  components: ComponentInfo[];   // Button, UserTable, Layout
  endpoints: EndpointInfo[];     // GET /api/users, POST /api/auth/login
  models: ModelInfo[];           // User, Document, Transaction
  dependencies: DependencyGraph; // file → imports
  fileContexts: Map<string, MiniContext>; // pre-built per-file contexts for Lane 2
  compressedContext: string;     // full project summary for LLM (~2000 tokens)
}
```

### Stack detection

Pattern-based, checked in order:
- `package.json` with `next` → Next.js
- `package.json` with `react-scripts` → CRA
- `package.json` with `vite` → Vite
- `*.csproj` → .NET
- `requirements.txt` / `pyproject.toml` → Python
- `go.mod` → Go
- `docker-compose.yml` → check services
- Fallback: ask LLM to analyze root directory listing

### Pre-built mini-contexts

For each file, store: file content + its direct imports' interfaces/types. This is the context packet sent to LLM for Lane 2 tasks. Pre-built at index time, updated on file change. Means Lane 2 doesn't waste time collecting context — it's already ready.

---

## Storage & Search — Zero Dependencies

Пользователю не нужно ставить базу данных. Всё хранится в папке `.nova/` в корне проекта.

### `.nova/` directory (добавляется в `.gitignore`)

```
.nova/
├── config.toml          # локальная конфигурация (API keys, preferences)
├── graph.json           # граф зависимостей (файлы → импорты → связи)
├── context.md           # сжатое описание проекта (context distillation)
├── index.db             # SQLite + sqlite-vec (Level 2, создаётся опционально)
├── embeddings/          # скачанная модель эмбеддингов (Level 2)
│   └── all-MiniLM-L6-v2.onnx  # 22MB, скачивается один раз
├── recipes/             # шаблоны типовых изменений
├── history/             # лог выполненных задач
└── cache/               # кэш mini-contexts для частых файлов
```

`rm -rf .nova` — и следа не осталось.

### Три уровня поиска (от простого к мощному)

**Level 1 — Граф + Keyword (MVP, ноль зависимостей)**

Для проектов до ~500 файлов (99% dev-проектов) семантический поиск не нужен. Граф зависимостей + keyword search работает лучше:

- Клик на `CustomerTable` → система проходит по импортам: `types/customer.ts` → `useCustomers` хук → `/api/customers` endpoint. Это граф, не вектора.
- Голосовой запрос "таблица клиентов" → keyword match по именам файлов/компонентов/роутов.
- Хранение: `graph.json` — обычный JSON. Обновляется при каждом изменении через AST-парсинг (`@swc/core` для JS/TS, regex по `using`/`import` для C#/Python/Go).
- Скорость: < 1ms на lookup. Обновление графа: < 100ms на файл.

```typescript
interface DependencyNode {
  filePath: string;
  imports: string[];        // files this file imports
  exports: string[];        // exported symbols
  type: 'component' | 'page' | 'api' | 'model' | 'hook' | 'util' | 'config';
  route?: string;           // if page: /dashboard, /customers
  keywords: string[];       // extracted identifiers for keyword search
}
```

**Level 2 — SQLite + sqlite-vec + локальные эмбеддинги (v0.3, опционально)**

Для абстрактных запросов типа "где у нас логика валидации?" граф не поможет. Тогда:

- **sqlite-vec** — расширение для SQLite, аналог pgvector. Работает как обычная таблица. Один файл `.nova/index.db`.
- **Эмбеддинги локально** — `all-MiniLM-L6-v2` через ONNX Runtime (22MB модель). Генерирует эмбеддинги за миллисекунды. Никакого API, никакого интернета после скачивания.
- Система сама предлагает: "Проект большой (800+ файлов), включить семантический поиск? Скачаю модель (22MB)."
- Пользователь отказался → работает на Level 1, просто менее точен для абстрактных запросов.

```sql
-- sqlite-vec: поиск похожих файлов
SELECT file_path, distance
FROM file_embeddings
WHERE embedding MATCH ?
ORDER BY distance
LIMIT 10;
```

**Level 3 — Внешняя БД (v0.5, плагин)**

Для команд с существующей инфраструктурой:

```toml
# nova.toml
[search]
provider = "postgres"    # или "pinecone", "qdrant", "chromadb"
connection = "postgresql://localhost:5432/nova"
```

Подключается через плагин. Пользователь сам решает. Система по умолчанию использует Level 1 или 2.

### Как уровни работают вместе

При поиске контекста для задачи система использует все доступные уровни:

```
1. Граф зависимостей (всегда) → точные связи: "этот компонент импортирует X, Y, Z"
2. Keyword search (всегда) → имена файлов, компонентов, функций
3. Семантический поиск (если Level 2+) → "похожий по смыслу код"
```

Результаты мержатся и ранжируются. Граф всегда имеет приоритет — если связь явная, вектора не нужны.

---

## Brain — Multimodal Analysis

Receives observation from overlay, decides what to do.

### Input

```typescript
interface Observation {
  screenshot: Buffer;              // PNG from html2canvas
  clickCoords?: { x: number; y: number };
  domSnapshot?: string;            // HTML around clicked element
  transcript?: string;             // voice → text
  currentUrl: string;              // /dashboard
  consoleErrors?: string[];        // captured from browser console
}
```

### Process

1. Match `currentUrl` to known route → load relevant file contexts
2. Build prompt: screenshot + transcript + project context
3. Send to multimodal model
4. Parse structured response: list of tasks with descriptions and affected files
5. Classify each task → assign lane
6. Dispatch to executor pool

### Prompt template

```
You are analyzing a web application. The user is interacting with it and wants changes.

Current page: {url} → maps to file: {filePath}
Project stack: {stack}
Project structure: {compressedContext}

[screenshot attached]

User said: "{transcript}"
User clicked on: {domSnapshot}

Respond with a JSON array of tasks:
[{
  "description": "what to do",
  "files": ["which files to modify"],
  "type": "css" | "single_file" | "multi_file" | "refactor"
}]
```

---

## Executor Pool

### Lane 1 — Instant (no LLM)

```typescript
// Example: "make this button blue"
// 1. Find element in DOM snapshot → map to CSS class/component
// 2. Find class in source file
// 3. Regex/AST replace color value
// 4. Write file → hot reload
```

For trivial edits, can also use Ollama locally — Qwen 2.5 Coder 1.5B generates a 3-line diff in ~1 second on M-series Mac.

### Lane 2 — Fast (single API call)

```typescript
// 1. Load pre-built mini-context for target file
// 2. Send to fast model: "modify this file to {task}. Respond with ONLY the diff."
// 3. Apply diff to file
// 4. Hot reload
```

### Lane 3 — Standard (decomposed)

```typescript
// 1. Brain already decomposed into subtasks
// 2. For each subtask: send to strong model with relevant file contexts
// 3. Execute subtasks (parallel where possible)
// 4. Each change = git commit on nova/{branch}
// 5. Validate: type-check + lint. Auto-fix if errors.
```

### Lane 4 — Background

```typescript
// 1. Spawn detached agent process
// 2. Agent has full project context + task description
// 3. Works autonomously, commits incrementally
// 4. Sends status updates to CLI core
// 5. On completion: notification in terminal + overlay
```

---

## Git Strategy

- On `nova` start: create branch `nova/{timestamp}` from current branch
- Each atomic change = one commit with descriptive message
- `nova review` shows all commits on current nova branch with diffs
- User can: approve (merge to parent branch), cherry-pick individual commits, rollback any commit
- Never touches main/master without explicit `nova merge` command

---

## Licensing & Business Model

Source-available, двухуровневая лицензия (модель Remotion).

### Лицензия

Код полностью открыт на GitHub — можно читать, запускать, форкать, контрибьютить. Но лицензия **не MIT и не Apache**. Кастомная лицензия Nova Architect License (NAL):

| | Free | Company License |
|--|------|----------------|
| **Кто** | Индивидуальные разработчики + команды до 3 человек | Компании от 4 человек |
| **Коммерческое использование** | Да | Да (с лицензией) |
| **Цена** | $0 навсегда | $25/мес за разработчика (min $100/мес) или $250/год за разработчика |
| **Ограничения** | Нельзя перепродавать, нельзя делать конкурирующий продукт | Нет |

**Что запрещено всем без enterprise-лицензии:**
- Перепродавать или встраивать в свой коммерческий SaaS
- Создавать конкурирующий продукт на базе этого кода
- Убирать телеметрию лицензирования

### Enforcement — пакет `@nova-architect/licensing`

Аналог `@remotion/licensing`. При запуске `nova`:
- Проверяет количество уникальных разработчиков в git-истории проекта
- Если <= 3 → бесплатно, без ограничений
- Если > 3 → требует license key (из env `NOVA_LICENSE_KEY` или `nova.toml`)
- Отправляет анонимную телеметрию: license key + количество разработчиков + хеш проекта. Без содержимого кода.
- Без валидного ключа: работает в degraded mode (только `nova chat`, без overlay и lane system)

### AI-модели — BYO key

Лицензия Nova не покрывает стоимость AI. Пользователь всегда приносит свой API-ключ:
- **OpenRouter** — доступ ко всем моделям, одним ключом
- **Anthropic** — Claude напрямую
- **OpenAI** — GPT модели
- **Ollama** — полностью бесплатно, локально, для Lane 1

### Тарифы

| Тариф | Цена | Что включено |
|-------|------|-------------|
| **Free** | $0 | Полный функционал. До 3 разработчиков. BYO API key. |
| **Company** | $25/мес/dev (min $100/мес) | Для команд 4+. Priority support. |
| **Enterprise** | Custom pricing | SSO, audit log, SLA, dedicated support, self-hosted telemetry. |
| **Nova Cloud** | $X/мес (TBD) | Managed-сервис: не нужно настраивать API-ключи. Мы управляем моделями, роутингом, кэшированием. "Всё из коробки". |

### Nova Cloud (future)

Managed backend вместо BYO key:
- Пользователь не настраивает API-ключи — всё работает через наш бэкенд
- Мы управляем: выбором модели, роутингом между провайдерами, кэшированием контекста
- Оптимальная стоимость: роутим простые задачи на дешёвые модели, сложные на дорогие
- Аналог Remotion Lambda — сам тул бесплатный, но облачный рендер — платный

### Recipe Marketplace (future)

Сообщество создаёт и продаёт рецепты (шаблоны типовых изменений) для разных стеков:
- Next.js, Django, Rails, Laravel, .NET — типовые операции без LLM
- Бесплатные community-рецепты + платные премиум-рецепты
- Платформа берёт комиссию (~30%)
- Создаёт экосистему вокруг продукта

### Почему эта модель работает

1. **Бесплатный для индивидуалов** → массовое принятие, community, buzz, контрибьюторы
2. **Платный для компаний** → revenue от тех, кто реально экономит деньги (час разработчика > $50, тул стоит $25/мес)
3. **Source-available** → доверие, прозрачность, возможность контрибьютить, но защита от клонов
4. **BYO key** → нет расходов на AI для нас, пользователь контролирует свои затраты
5. **Cloud и Marketplace** → дополнительные revenue streams для масштабирования

---

## Project Structure

```
nova-architect/
├── packages/
│   ├── cli/                          # Main CLI entry point
│   │   ├── src/
│   │   │   ├── index.ts              # CLI entry: arg parsing, command routing
│   │   │   ├── commands/
│   │   │   │   ├── start.ts          # `nova` — full mode
│   │   │   │   ├── chat.ts           # `nova chat` — terminal only
│   │   │   │   ├── watch.ts          # `nova watch` — passive observe
│   │   │   │   ├── tasks.ts          # `nova tasks` — show queue
│   │   │   │   ├── review.ts         # `nova review` — show changes
│   │   │   │   ├── init.ts           # `nova init` — create config
│   │   │   │   └── status.ts         # `nova status` — show state
│   │   │   ├── config.ts             # nova.toml reader/writer
│   │   │   └── setup.ts              # First-run interactive setup
│   │   ├── bin/
│   │   │   └── nova.ts               # Shebang entry point
│   │   └── package.json
│   │
│   ├── core/                          # Shared core logic
│   │   ├── src/
│   │   │   ├── indexer/
│   │   │   │   ├── ProjectIndexer.ts
│   │   │   │   ├── StackDetector.ts
│   │   │   │   ├── DependencyGraph.ts  # Level 1: JSON graph
│   │   │   │   ├── RouteExtractor.ts
│   │   │   │   ├── ComponentExtractor.ts
│   │   │   │   └── ContextDistiller.ts
│   │   │   ├── storage/
│   │   │   │   ├── NovaDir.ts          # .nova/ directory manager
│   │   │   │   ├── GraphStore.ts       # Level 1: graph.json read/write
│   │   │   │   ├── SqliteStore.ts      # Level 2: sqlite-vec + embeddings
│   │   │   │   ├── EmbeddingModel.ts   # ONNX runtime, local MiniLM
│   │   │   │   └── SearchRouter.ts     # Merges results from all levels
│   │   │   ├── brain/
│   │   │   │   ├── Brain.ts           # Multimodal analysis
│   │   │   │   ├── LaneClassifier.ts
│   │   │   │   └── TaskDecomposer.ts
│   │   │   ├── executor/
│   │   │   │   ├── ExecutorPool.ts
│   │   │   │   ├── Lane1Executor.ts   # AST/regex, no LLM
│   │   │   │   ├── Lane2Executor.ts   # Single-file, fast model
│   │   │   │   ├── Lane3Executor.ts   # Multi-file, strong model
│   │   │   │   └── Lane4Executor.ts   # Background agent
│   │   │   ├── git/
│   │   │   │   └── GitManager.ts      # Branch, commit, rollback
│   │   │   ├── models/
│   │   │   │   ├── types.ts           # ProjectMap, Observation, Task, etc.
│   │   │   │   └── config.ts          # nova.toml types
│   │   │   └── llm/
│   │   │       ├── LlmClient.ts       # Unified interface
│   │   │       ├── AnthropicProvider.ts
│   │   │       ├── OpenRouterProvider.ts
│   │   │       ├── OpenAIProvider.ts
│   │   │       └── OllamaProvider.ts
│   │   └── package.json
│   │
│   ├── proxy/                         # Dev server proxy + script injection
│   │   ├── src/
│   │   │   ├── ProxyServer.ts         # HTTP proxy with HTML injection
│   │   │   ├── WebSocketServer.ts     # Overlay ↔ CLI communication
│   │   │   ├── DevServerRunner.ts     # Spawn & manage user's dev server
│   │   │   └── ScreenshotService.ts   # Puppeteer fallback for screenshots
│   │   └── package.json
│   │
│   ├── licensing/                      # License validation & telemetry
│   │   ├── src/
│   │   │   ├── LicenseChecker.ts      # Validate key, count devs in git
│   │   │   ├── Telemetry.ts           # Anonymous usage reporting
│   │   │   └── types.ts
│   │   └── package.json
│   │
│   └── overlay/                       # Injected browser script
│       ├── src/
│       │   ├── index.ts               # Entry point, injected into pages
│       │   ├── ui/
│       │   │   ├── OverlayPill.ts     # Floating control pill
│       │   │   ├── CommandInput.ts    # Text/voice input panel
│       │   │   ├── ElementSelector.ts # Click-to-select mode
│       │   │   └── StatusToast.ts     # "Applying changes..." notifications
│       │   ├── capture/
│       │   │   ├── ScreenshotCapture.ts  # html2canvas wrapper
│       │   │   ├── DomCapture.ts         # DOM snapshot of selected element
│       │   │   ├── VoiceCapture.ts       # Web Speech API
│       │   │   └── ConsoleCapture.ts     # Intercept console.error
│       │   └── transport/
│       │       └── WebSocketClient.ts    # Send observations to proxy
│       ├── package.json
│       └── tsup.config.ts             # Bundles to single nova-overlay.js
│
├── docs/
│   ├── PROJECT_PLAN.md                # This file
│   └── HOW_IT_WORKS.md
├── nova.toml.example                  # Example config
├── package.json                       # Monorepo root (turborepo/pnpm workspaces)
├── turbo.json
├── tsconfig.base.json
├── CLAUDE.md
├── LICENSE                            # Nova Architect License (NAL)
└── README.md
```

---

## Data Flow

```
User opens browser at localhost:3001 (proxy port)
         |
Proxy serves user's app (from localhost:3000) with injected nova-overlay.js
         |
User interacts: clicks element + says "add search here"
         |
Overlay captures: screenshot + click coords + DOM + transcript
         |  (WebSocket)
         v
Proxy receives observation, forwards to CLI core
         |
         v
Brain: sends screenshot + transcript + project context to multimodal LLM
         |
         v
LLM responds: [{task: "add SearchInput component to /customers page", files: [...], type: "single_file"}]
         |
         v
Classifier: type=single_file → Lane 2
         |
         v
Lane 2 Executor: loads pre-built mini-context → sends to fast model → gets diff → applies to file
         |
         v
File change triggers dev server hot reload
         |
         v
Browser auto-updates → user sees SearchInput on /customers page
         |
Overlay shows toast: "Added search to /customers — nova/1710583200"
```

---

## MVP — v0.1

Goal: CLI that connects to a project, opens browser with overlay, lets you click + type to request changes, applies them via LLM.

### In scope

1. **CLI** — `nova` command, first-run setup, `nova.toml` creation
2. **Project Indexer** — basic: detect stack (Node.js, .NET), list files, extract route list
3. **Dev Server Runner** — spawn `npm run dev` / `dotnet run`, detect port
4. **Proxy** — proxy localhost, inject overlay script
5. **Overlay** — floating pill, click-to-select, text input (no voice yet), screenshot capture
6. **Brain** — Claude Sonnet via API: screenshot + text + project context → task list
7. **Lane 2 Executor** — single-file changes via API, apply diff, hot reload
8. **Git** — create branch, commit each change

### Not in v0.1

- Voice (v0.2 — Web Speech API)
- Lane 1 / local model (v0.2)
- Lane 3-4 / multi-file / background (v0.3)
- Passive observation (v0.3)
- Recipe engine (v0.4)
- `nova chat` terminal mode (v0.2)
- `nova review` / `nova tasks` (v0.2)

---

## Roadmap

### v0.1 — Core Loop
- CLI + setup + config
- Indexer (basic)
- Proxy + overlay (click + text)
- Brain (Sonnet multimodal)
- Lane 2 executor
- Git branching + commits

### v0.2 — Voice & Speed
- Web Speech API in overlay
- Lane 1: Ollama local model for CSS/text edits
- `nova chat` — terminal-only mode
- `nova tasks` / `nova review` commands
- Better terminal UI (ink or ora)

### v0.3 — Intelligence & Semantic Search
- Lane 3: multi-file decomposition + parallel execution
- Lane 4: background agents
- Passive observation mode (`nova watch`)
- Console error detection → auto-fix suggestions
- Pre-built mini-contexts for Lane 2 speedup
- **Search Level 2**: SQLite + sqlite-vec + local embeddings (all-MiniLM-L6-v2, 22MB)
- Semantic search for abstract queries ("where is validation logic?")

### v0.4 — Optimization
- Recipe engine: parameterized templates, zero-LLM execution
- Speculative context loading
- Batched voice commands → parallel execution
- Streaming diffs (apply as generated)

### v0.5 — Polish & Extensibility
- Plugin system for custom stack support
- **Search Level 3**: external DB plugins (PostgreSQL, Pinecone, Qdrant)
- Team features: shared nova.toml, shared recipes
- `nova merge` — interactive merge flow
- Dashboard web UI (optional, for visual review)
- Recipe marketplace

---

## Key Design Decisions

### Proxy injection vs Electron

| | Proxy + Script | Electron |
|--|---------------|----------|
| Install size | ~50MB | ~500MB |
| Browser | Any (Chrome, Firefox, Safari) | Chromium only |
| Setup | `npm install -g` | Separate download |
| Dev tools | User's own browser dev tools | Electron dev tools (different) |
| Complexity | Simple (inject `<script>`) | Complex (BrowserWindow, preload, IPC) |
| Limitation | Can't capture outside browser | Full OS access |

**Decision: Proxy.** For a CLI tool, lightweight distribution wins. Electron can be added later as optional "desktop mode" if needed.

### Monorepo with packages

4 packages: `cli`, `core`, `proxy`, `overlay`. Keeps concerns separated, allows independent testing, but ships as single `npm install`.

Using **pnpm workspaces + turborepo** for build orchestration.

### LLM provider abstraction

`LlmClient` interface with pluggable providers (Anthropic, OpenRouter, OpenAI, Ollama). User picks provider in `nova.toml`. Easy to add new providers.

### Why not use Claude Code / Codex as executor?

Could shell out to `claude` CLI for Lane 3-4 tasks. But:
- Adds dependency on another CLI tool
- Less control over prompts, context, output format
- Can't do diff-only responses

Instead: direct API calls with our own prompts optimized for diff output. For Lane 4, may optionally integrate with Claude Code if installed.

---

## Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| LLM hallucination breaks code | High | Type-check + lint after each edit. Auto-rollback on failure. |
| Proxy breaks app behavior | Medium | Minimal injection — one `<script>` tag at end of `<body>`. No CSS interference. Test with popular frameworks. |
| Voice recognition errors | Medium | Show transcript for confirmation before executing. Easy to edit. |
| Complex projects fail to index | Medium | Graceful degradation — work with partial index. Ask user in terminal. |
| html2canvas screenshot quality | Low | Fallback to Puppeteer headless screenshot. Configurable. |
| CORS/CSP blocks overlay | Medium | Proxy strips CSP headers for dev. Document in README. |
