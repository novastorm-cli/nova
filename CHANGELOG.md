# Changelog

All notable changes to Novastorm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-05-15

Novastorm v1.0.0 is a major release focused on security hardening, cross-platform reliability,
overlay UI/UX polish, architecture refactor, performance, and onboarding improvements.

### Breaking Changes

- **Removed stub commands** `chat`, `tasks`, `watch`, `review`. Running any of these prints a
  deprecation hint ("gone in v1.0 — use … instead") and exits with code 2.
  See [VAL-CLI-036][], [VAL-CLI-037][].
- **Proxy default bind** changed from `0.0.0.0` to `127.0.0.1` (localhost only). Nova is no
  longer accessible from other devices on the network by default. Opt in with `--host 0.0.0.0`.
  See [VAL-SEC-001][], [VAL-SEC-002][], [VAL-SEC-003][].
- **Telemetry now requires explicit opt-in**. On first run, Nova asks "Help improve Nova by
  sharing anonymous usage telemetry? [y/N]" (default: **no**). The machine ID is now a v4 UUID
  (`crypto.randomUUID()`), not a MAC-address hash. See [VAL-CLI-008][], [VAL-SEC-031][].
- **Task auto-execute is now opt-in**. Tasks require explicit confirmation (chat `y`/`yes`,
  overlay Execute button, or Quick Edit / Multi-Edit) unless `--yes` or
  `behavior.confirmTasks=false` is set. See [VAL-CLI-031][], [VAL-CLI-032][], [VAL-CLI-033][].
- **Dev server commands no longer use a shell**. `[devServer] command` is parsed as a literal
  executable + args; shell features (`$`, `&&`, `|`, `>`) are rejected. This prevents command
  injection from config files. See [VAL-SEC-017][], [VAL-SEC-018][], [VAL-SEC-019][].
- **Package renamed** from `nova-architect` to `@novastorm-ai/cli`.
  See [VAL-CLI-049][], [VAL-CLI-052][].
- **Config schema**: legacy `[providers]` block is auto-migrated to `[apiKeys]` on first read.
  See [VAL-CROSS-020][].

### Added

- **DeepSeek provider** with models `deepseek-v4-pro` and `deepseek-v4-flash`. Fully integrated
  into `nova setup`, provider ping, `nova doctor`, and all LLM flows. `reasoning_content` is
  surfaced in streaming responses. See [VAL-CLI-027][], [VAL-CLI-028][], [VAL-CLI-029][],
  [VAL-CLI-030][].
- **`nova doctor`** — system diagnostic command. Checks provider connectivity, port availability,
  Node version, Git availability, `.nova/` writability, Claude CLI / Ollama reachability (when
  configured), and package version currency. See [VAL-CLI-011][] through [VAL-CLI-019][].
- **New CLI flags**: `--no-open`, `--yes`, `--port <N>`, `--proxy-port <N>`, `--no-telemetry`,
  `--host <addr>`. See [VAL-CLI-001][] through [VAL-CLI-010][].
- **New env vars**: `NOVA_NON_INTERACTIVE=1` (skip all prompts), `NOVA_QUIET=1` (suppress
  banner), `NO_COLOR=1` (no ANSI escapes), `NOVA_TELEMETRY=false` (disable telemetry).
  See [VAL-CLI-005][], [VAL-CLI-006][], [VAL-CLI-007][].
- **Overlay theme system** — `data-theme="light|dark|auto"` with design tokens. `auto` mode
  follows `prefers-color-scheme`. See [VAL-OVERLAY-026][], [VAL-OVERLAY-027][],
  [VAL-OVERLAY-028][].
- **Modal accessibility** — all modals (`DiffModal`, `SecretConsole`, `ElementInspector`) declare
  `role="dialog"`, `aria-modal="true"`, trap focus, restore focus on close, and include visible
  close buttons. See [VAL-OVERLAY-016][] through [VAL-OVERLAY-021][].
- **Unified status state machine** — single FSM drives pill color, status line text, and
  `aria-live="polite"` mirror. See [VAL-OVERLAY-008][], [VAL-OVERLAY-009][],
  [VAL-OVERLAY-010][].
- **DiffModal enrichments** — Copy diff, Open file (`vscode://`), Revert this file, `+N -M`
  stats badge. See [VAL-OVERLAY-022][] through [VAL-OVERLAY-025][].
- **Platform-aware shortcut glyphs** — `⌥` on macOS, `Alt+` elsewhere. Shortcuts are suppressed
  inside editable fields (`isEditableTarget` guard).
  See [VAL-OVERLAY-007][], [VAL-OVERLAY-030][], [VAL-OVERLAY-033][].
- **Global keyboard shortcuts**: `Cmd/Ctrl+K` (focus transcript), `Alt+I` (Quick Edit), `Alt+K`
  (Multi-Edit), `Alt+A` (Area Selector), `Alt+M` (Project Map), `Shift+?` (pill menu).
  See [VAL-OVERLAY-012][], [VAL-OVERLAY-030][], [VAL-OVERLAY-031][], [VAL-OVERLAY-032][],
  [VAL-OVERLAY-051][].
- **Voice feedback** — amplitude meter on mic, "No audio detected — check microphone permissions"
  hint after 3 s of silence, auto-stop after 10 s of silence, `NotAllowed` error explanation.
  See [VAL-OVERLAY-043][] through [VAL-OVERLAY-047][].
- **`prefers-reduced-motion` media query** — disables all overlay `@keyframes` when the user
  prefers reduced motion. See [VAL-OVERLAY-052][].
- **Inspector highlight always visible** — 2 px solid white outline + box-shadow ring on any host
  background (`#fff`, `#000`, `#888`). See [VAL-OVERLAY-048][].
- **`nova update` EACCES detection** — prints a PM-specific remedy (npm / pnpm / yarn / volta /
  asdf) without a stack trace. See [VAL-CLI-047][], [VAL-CLI-048][].
- **Backward-compat `models.fast` alias** — reads the value as `models.standard` with a one-time
  deprecation warning. See [VAL-CLI-038][], [VAL-CLI-040][].
- **`install-id` generation** — `~/.nova/install-id` created on first setup containing a v4 UUID
  (`crypto.randomUUID()`). See [VAL-CLI-025][].
- **Session token rotation** — per-startup WebSocket token written to `.nova/session-token`
  (`0600`). See [VAL-SEC-004][], [VAL-SEC-006][].
- **`nova bible` lazy-load** — the large ANSI manifesto block is loaded on demand.
- **Indexer streaming + caching** — early-prune of `node_modules`/`.next`/`dist`, content hash
  persistence, lazy-load file content.
- **LLM retry with exponential backoff** — 1/2/4 s across all providers, live WS feedback, micro
  fallback on final failure.
- **Strict TypeScript** — `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` enabled
  repo-wide.
- **`SECURITY_TESTS.md`** — catalog of security test coverage.
  See [VAL-SEC-040][], [VAL-SEC-041][].

### Changed

- **Brand**: "Nova Architect" renamed to "Novastorm" across CLI banner, setup welcome, README,
  and all documentation. See [VAL-CLI-041][], [VAL-CLI-042][], [VAL-CLI-043][].
- **Model tiers**: `models.fast` → `models.standard`, `models.micro` added for simple tasks.
  `models.strong` is unchanged. See [VAL-CLI-038][], [VAL-CLI-039][], [VAL-CLI-050][].
- **Provider key validation in `nova setup`** — 1-token verification chat, empty keys rejected,
  remedy URLs surfaced on failure. See [VAL-CLI-021][], [VAL-CLI-022][], [VAL-CLI-023][].
- **Banner suppressed** on non-TTY stdout and non-`start` subcommands
  (`nova --version`, `nova doctor`, etc.). See [VAL-CLI-009][], [VAL-CLI-010][].
- **Port-busy resolution** uses Node-native methods (no `lsof | xargs kill -9`).
  See [VAL-CLI-044][].
- **Claude CLI provider** uses stdin pipe instead of shell-based temp files; throws
  `ProviderError(NO_VISION_SUPPORT)` on vision attempts. See [VAL-SEC-026][], [VAL-SEC-027][].
- **Architecture refactor** — `cli/src/commands/start.ts` split from 1372 LOC into `boot/`
  modules; `BaseProvider` + `ChatTransport` strategy; `Executor` FSM with `RetryPolicy`.
- **Workspace dep hygiene** — `@novastorm-ai/{core,proxy,licensing}` moved from `devDependencies`
  to `dependencies` in `cli/package.json`; provider SDK de-duplication.
- **ESLint + Prettier** — strict-plus-stylistic flat config, `no-console` enforced for production
  packages, non-ASCII string literals gated behind `strings.ts`.
- **Coverage gate** — vitest `--coverage` with v8 provider, thresholds at 70% (core, proxy) and
  60% (cli).

### Deprecated

- **`models.fast` alias** — use `models.standard`. Emits a one-time deprecation warning on first
  read. Will be removed in v2.0. See [VAL-CLI-038][], [VAL-CLI-040][].
- **Legacy `[providers]` config block** — auto-migrated to `[apiKeys]` on first read.
  See [VAL-CROSS-020][].

### Removed

- **Stub commands** `chat`, `tasks`, `watch`, `review` — removed from the CLI surface and
  commander registration. Running them exits with code 2 and a deprecation hint.
  See [VAL-CLI-036][], [VAL-CLI-037][].
- **`fuzzyApplyDiff`** — replaced by full-file retry in the Executor FSM (DiffApplyStrategy).
- **MAC-address-based machineId** — replaced with v4 UUID (`~/.nova/install-id`).
  See [VAL-SEC-031][].
- **`shell: true` in DevServerRunner** — all spawns use literal arg arrays.
  See [VAL-SEC-017][].

### Fixed

- **Cross-platform port killer** — `lsof | xargs kill -9` replaced with `kill-port` (Node-native
  fallback). See [VAL-CLI-044][].
- **Pill position persistence** — drag position survives reload (>4 px deadzone), saved position
  clamped to viewport. See [VAL-OVERLAY-059][], [VAL-OVERLAY-060][].
- **Russian literal leak** — Cyrillic dead-click prompt replaced with English strings in
  `strings.ts`. See [VAL-OVERLAY-029][].
- **PathGuard glob collapse** — `pattern.replace(/\*\*.*/, '')` removed; `picomatch` used
  consistently. `src/**/*.ts` no longer allows writes to `src/secret.env` or `lib/index.ts`.
  See [VAL-SEC-020][] through [VAL-SEC-025][].
- **ActivityLog auto-uncollapse** — no longer restores on every stream chunk; unread-count badge
  instead. Auto-uncollapse only on `error`. See [VAL-OVERLAY-034][] through
  [VAL-OVERLAY-036][].
- **TaskPanel lifecycle** — auto-hides 5 s after all tasks complete, pin-on-hover, explicit
  close button, recent-tasks persistence in `localStorage`.
  See [VAL-OVERLAY-038][] through [VAL-OVERLAY-042][].
- **Modal click pass-through** — clicking inside a dialog no longer activates host-page elements
  behind it. See [VAL-OVERLAY-021][], [VAL-OVERLAY-049][].
- **Layout stacking** — panels (ActivityLog, SuggestionPanel, TaskPanel) placed in non-overlapping
  slots; pill always above panels, modals above everything.
  See [VAL-OVERLAY-057][], [VAL-OVERLAY-058][].
- **Pre-existing test failures** — proxy HTML-injection assertion, indexer ENOENT race condition,
  two orphan HTTP listeners in proxy/integration tests.
- **`localhost` vs `127.0.0.1`** — consistent `127.0.0.1` in Ollama embedding config and scaffold
  defaults.
- **`nova update` EACCES** — clean human-readable message instead of a Node.js stack trace.
  See [VAL-CLI-048][].

### Security

- **Per-session WebSocket token** — 64-char hex token written to `.nova/session-token` (`0600`),
  injected into overlay `<script>` via `data-nova-session`, required in every WS upgrade request.
  Mismatch returns 401. Token rotates on each restart.
  See [VAL-SEC-004][] through [VAL-SEC-010][].
- **Origin header check on WebSocket upgrade** — `Origin: http://localhost:<port>` required even
  with a valid token; foreign origins rejected (403). Missing `Origin` header rejected.
  See [VAL-SEC-011][], [VAL-SEC-012][], [VAL-SEC-013][].
- **Proxy loopback bind by default** — `127.0.0.1` only, no IPv6 wildcard. Opt-in `--host` for
  LAN exposure prints a warning. See [VAL-SEC-001][], [VAL-SEC-002][], [VAL-SEC-003][],
  [VAL-SEC-014][], [VAL-SEC-015][], [VAL-SEC-016][].
- **DevServerRunner no shell** — `spawn(cmd, args, { shell: false })` prevents command injection
  via `[devServer] command`. Shell metacharacters (`$`, `&&`) are rejected.
  See [VAL-SEC-017][], [VAL-SEC-018][], [VAL-SEC-019][].
- **PathGuard correctness** — `picomatch`-based writable pattern matching; denies extension
  mismatches, path traversal (`..`), and sibling directories.
  See [VAL-SEC-020][] through [VAL-SEC-025][].
- **Secret redaction** — API keys (`sk-[A-Za-z0-9]{20,}`) replaced with `sk-***` in all log
  output, including `--debug` mode. See [VAL-SEC-034][], [VAL-SEC-035][].
- **Branch safety** — Nova refuses to commit directly to `main`/`master`/`develop` without
  `[git] allowProtectedBranchCommits = true`. See [VAL-SEC-036][], [VAL-SEC-037][],
  [VAL-SEC-038][].
- **Claude CLI portability** — no shell ancestor, no temp file machinery, stdin pipe,
  `ProviderError(NO_VISION_SUPPORT)` instead of silent degradation.
  See [VAL-SEC-026][], [VAL-SEC-027][].
- **Telemetry UUID not MAC** — `~/.nova/install-id` is a v4 UUID (`crypto.randomUUID()`); no
  `os.networkInterfaces()` sourcing. See [VAL-SEC-031][], [VAL-SEC-032][], [VAL-SEC-033][].

### For Package Maintainers

- `http-proxy@^1.18` replaced with `http-proxy-3` (1.23.2) in the proxy package.
- `findLastIndex` polyfills dropped — Node 22 has native `Array.prototype.findLastIndex`.
- `StackDetector.ts` lookup tables extracted to `stack-presets.json`.
- `Brain.parseJsonArray` replaced fragile regex with brace-counting parser.

---

[1.0.0]: https://github.com/baoilai/nova/releases/tag/v1.0.0

[VAL-CLI-001]: validation-contract.md#val-cli-001---no-open-suppresses-browser-launch
[VAL-CLI-002]: validation-contract.md#val-cli-002---yes-skips-all-interactive-prompts-in-non-setup-commands
[VAL-CLI-003]: validation-contract.md#val-cli-003---portn-binds-nova-to-the-supplied-port-when-free
[VAL-CLI-004]: validation-contract.md#val-cli-004---proxy-portn-binds-the-nova-proxy-to-the-supplied-port
[VAL-CLI-005]: validation-contract.md#val-cli-005-nova_non_interactive1-makes-every-prompt-a-no-op-default
[VAL-CLI-006]: validation-contract.md#val-cli-006-nova_quiet1-suppresses-the-ansi-banner
[VAL-CLI-007]: validation-contract.md#val-cli-007-no_color1-produces-colorless-output
[VAL-CLI-008]: validation-contract.md#val-cli-008---no-telemetry-disables-the-telemetry-opt-in-flow
[VAL-CLI-009]: validation-contract.md#val-cli-009-banner-is-suppressed-on-non-tty-stdout
[VAL-CLI-010]: validation-contract.md#val-cli-010-banner-is-suppressed-for-non-start-subcommands
[VAL-CLI-011]: validation-contract.md#val-cli-011-nova-doctor-exits-0-on-a-healthy-system
[VAL-CLI-012]: validation-contract.md#val-cli-012-nova-doctor-exits-non-zero-when-a-provider-key-is-missinginvalid
[VAL-CLI-013]: validation-contract.md#val-cli-013-nova-doctor-reports-port-availability-for-the-default-port
[VAL-CLI-014]: validation-contract.md#val-cli-014-nova-doctor-reports-node-version
[VAL-CLI-015]: validation-contract.md#val-cli-015-nova-doctor-reports-git-presence
[VAL-CLI-016]: validation-contract.md#val-cli-016-nova-doctor-checks-nova-writability
[VAL-CLI-017]: validation-contract.md#val-cli-017-nova-doctor-checks-claude-cli-presence-when-configured
[VAL-CLI-018]: validation-contract.md#val-cli-018-nova-doctor-checks-ollama-reachability-when-configured
[VAL-CLI-019]: validation-contract.md#val-cli-019-nova-doctor-reports-package-version-mismatch-with-npm
[VAL-CLI-021]: validation-contract.md#val-cli-021-nova-setup-validates-a-non-local-provider-key-with-a-1-token-chat
[VAL-CLI-022]: validation-contract.md#val-cli-022-nova-setup-refuses-an-empty-key-for-non-local-providers-or-requires-explicit-skip
[VAL-CLI-023]: validation-contract.md#val-cli-023-nova-setup-surfaces-a-remedy-url-on-key-failure
[VAL-CLI-025]: validation-contract.md#val-cli-025-nova-setup-generates-novainstall-id-as-a-v4-uuid
[VAL-CLI-027]: validation-contract.md#val-cli-027-deepseek-configured-end-to-end-passes-provider-ping
[VAL-CLI-028]: validation-contract.md#val-cli-028-modelsstandarddeepseek-v4-pro-is-honored
[VAL-CLI-029]: validation-contract.md#val-cli-029-vision-attempts-on-deepseek-do-not-crash-the-cli
[VAL-CLI-030]: validation-contract.md#val-cli-030-deepseek-reasoning_content-does-not-crash-streaming-consumers
[VAL-CLI-031]: validation-contract.md#val-cli-031-without---yes-observations-populate-pendingtasks-and-do-not-mutate-files
[VAL-CLI-032]: validation-contract.md#val-cli-032---yes-flag-auto-executes-pending-tasks
[VAL-CLI-033]: validation-contract.md#val-cli-033-behaviorconfirmtasksfalse-auto-executes-without---yes
[VAL-CLI-036]: validation-contract.md#val-cli-036-nova-chat-nova-tasks-nova-watch-nova-review-are-absent-from---help
[VAL-CLI-037]: validation-contract.md#val-cli-037-removed-commands-exit-with-code-2-and-deprecation-hint
[VAL-CLI-038]: validation-contract.md#val-cli-038-models-fast---is-accepted-and-aliased-to-standard
[VAL-CLI-039]: validation-contract.md#val-cli-039-models-strong---continues-to-work-without-warning
[VAL-CLI-040]: validation-contract.md#val-cli-040-deprecation-notice-mentions-v20-removal
[VAL-CLI-041]: validation-contract.md#val-cli-041-cli-banner-says-novastorm
[VAL-CLI-042]: validation-contract.md#val-cli-042-nova-setup-welcome-screen-says-novastorm
[VAL-CLI-043]: validation-contract.md#val-cli-043-readme-and-docs-do-not-contain-nova-architect
[VAL-CLI-044]: validation-contract.md#val-cli-044-port-busy-resolution-does-not-shell-out-to-lsof--xargs-kill
[VAL-CLI-047]: validation-contract.md#val-cli-047-nova-update-on-eacces-prints-a-pm-specific-remedy
[VAL-CLI-048]: validation-contract.md#val-cli-048-nova-update-on-eacces-does-not-print-a-stack-trace
[VAL-CLI-049]: validation-contract.md#val-cli-049-docsquickstartmd-install-command-uses-novastorm-aicli
[VAL-CLI-050]: validation-contract.md#val-cli-050-quickstartreadmeconfigurationtips-reference-modelsmicrostandardstrong
[VAL-CLI-052]: validation-contract.md#val-cli-052-quickstart-install-command-actually-resolves-on-npm

[VAL-OVERLAY-007]: validation-contract.md#val-overlay-007-platform-aware-shortcut-glyphs-in-pill-menu
[VAL-OVERLAY-008]: validation-contract.md#val-overlay-008-status-line-text-reflects-current-fsm-state
[VAL-OVERLAY-009]: validation-contract.md#val-overlay-009-state-transitions-reflected-in-status-line-within-300-ms
[VAL-OVERLAY-010]: validation-contract.md#val-overlay-010-aria-livepolite-mirror-announces-state-changes
[VAL-OVERLAY-012]: validation-contract.md#val-overlay-012-cmdctrlk-focuses-the-transcript-input-from-anywhere-on-the-page
[VAL-OVERLAY-016]: validation-contract.md#val-overlay-016-diffmodal-declares-dialog-role-and-aria-modal
[VAL-OVERLAY-017]: validation-contract.md#val-overlay-017-secretconsole-and-elementinspector-popup-declare-dialog-semantics
[VAL-OVERLAY-018]: validation-contract.md#val-overlay-018-focus-is-trapped-inside-open-modals
[VAL-OVERLAY-019]: validation-contract.md#val-overlay-019-escape-closes-the-modal-and-returns-focus-to-the-opener
[VAL-OVERLAY-020]: validation-contract.md#val-overlay-020-visible-close-button-with-aria-label-on-every-modal
[VAL-OVERLAY-021]: validation-contract.md#val-overlay-021-secretconsole-blocks-click-pass-through-to-host-page
[VAL-OVERLAY-022]: validation-contract.md#val-overlay-022-diffmodal-toolbar-shows-copy-open-file-revert-stats-badge
[VAL-OVERLAY-023]: validation-contract.md#val-overlay-023-copy-diff-writes-unified-diff-to-clipboard
[VAL-OVERLAY-024]: validation-contract.md#val-overlay-024-revert-this-file-triggers-a-server-side-revert-event
[VAL-OVERLAY-025]: validation-contract.md#val-overlay-025-stats-badge-n--m-matches-diff-content
[VAL-OVERLAY-026]: validation-contract.md#val-overlay-026-auto-theme-follows-prefers-color-scheme
[VAL-OVERLAY-027]: validation-contract.md#val-overlay-027-explicit-data-theme-override-is-honoured
[VAL-OVERLAY-028]: validation-contract.md#val-overlay-028-activitylog--pill--inspector-readable-on-white-and-black-host-backgrounds
[VAL-OVERLAY-029]: validation-contract.md#val-overlay-029-no-cyrillic-or-non-english-literals-leak-to-the-rendered-overlay
[VAL-OVERLAY-030]: validation-contract.md#val-overlay-030-optioni-activates-quick-edit-layout-independent
[VAL-OVERLAY-031]: validation-contract.md#val-overlay-031-optionk-activates-multi-edit
[VAL-OVERLAY-032]: validation-contract.md#val-overlay-032-optionm-opens-the-project-map
[VAL-OVERLAY-033]: validation-contract.md#val-overlay-033-global-shortcuts-are-suppressed-inside-editable-fields
[VAL-OVERLAY-034]: validation-contract.md#val-overlay-034-activitylog-auto-opens-on-the-first-task
[VAL-OVERLAY-035]: validation-contract.md#val-overlay-035-activitylog-does-not-auto-uncollapse-on-subsequent-non-error-entries
[VAL-OVERLAY-036]: validation-contract.md#val-overlay-036-error-entries-auto-uncollapse-a-user-collapsed-log
[VAL-OVERLAY-038]: validation-contract.md#val-overlay-038-taskpanel-auto-hides-5-s-after-all-tasks-complete
[VAL-OVERLAY-039]: validation-contract.md#val-overlay-039-pin-on-hover-prevents-taskpanel-auto-hide
[VAL-OVERLAY-040]: validation-contract.md#val-overlay-040-explicit-close-button-on-taskpanel-hides-it-immediately
[VAL-OVERLAY-041]: validation-contract.md#val-overlay-041-recent-tasks-entry-in-pill-dropdown-reopens-taskpanel
[VAL-OVERLAY-042]: validation-contract.md#val-overlay-042-recent-tasks-persist-in-localstorage-across-reload
[VAL-OVERLAY-043]: validation-contract.md#val-overlay-043-clicking-mic-starts-recording-and-reflects-state-in-aria-label
[VAL-OVERLAY-044]: validation-contract.md#val-overlay-044-amplitude-meter-is-rendered-on-the-mic-button-while-listening
[VAL-OVERLAY-045]: validation-contract.md#val-overlay-045-no-audio-hint-after-3-s-of-silence
[VAL-OVERLAY-046]: validation-contract.md#val-overlay-046-10-s-of-silence-auto-stops-listening
[VAL-OVERLAY-047]: validation-contract.md#val-overlay-047-notallowed-microphone-error-produces-a-user-visible-explanation
[VAL-OVERLAY-048]: validation-contract.md#val-overlay-048-inspector-highlight-visible-on-any-host-background
[VAL-OVERLAY-049]: validation-contract.md#val-overlay-049-inspector-popup-clicks-do-not-activate-host-elements-behind-it
[VAL-OVERLAY-051]: validation-contract.md#val-overlay-051-area-selector-hotkey-is-layout-independent
[VAL-OVERLAY-052]: validation-contract.md#val-overlay-052-prefers-reduced-motion-disables-decorative-animations
[VAL-OVERLAY-057]: validation-contract.md#val-overlay-057-default-position-panels-do-not-overlap-each-other
[VAL-OVERLAY-058]: validation-contract.md#val-overlay-058-z-index-hierarchy-modals-above-panels-above-pill
[VAL-OVERLAY-059]: validation-contract.md#val-overlay-059-drag-position-persists-across-reload
[VAL-OVERLAY-060]: validation-contract.md#val-overlay-060-saved-position-is-clamped-into-the-visible-viewport-on-reload

[VAL-SEC-001]: validation-contract.md#val-sec-001-proxy-http-port-is-bound-to-127001-only
[VAL-SEC-002]: validation-contract.md#val-sec-002-websocket-listener-shares-the-loopback-bind
[VAL-SEC-003]: validation-contract.md#val-sec-003-no-ipv6-wildcard-bind-by-default
[VAL-SEC-004]: validation-contract.md#val-sec-004-session-token-file-is-created-on-startup
[VAL-SEC-005]: validation-contract.md#val-sec-005-token-appears-in-proxied-html-overlay-script-tag
[VAL-SEC-006]: validation-contract.md#val-sec-006-token-regenerates-across-restarts
[VAL-SEC-007]: validation-contract.md#val-sec-007-token-is-not-echoed-to-stdoutlog-in-normal-mode
[VAL-SEC-008]: validation-contract.md#val-sec-008-ws-upgrade-without-token-is-rejected
[VAL-SEC-009]: validation-contract.md#val-sec-009-ws-upgrade-with-wrong-token-is-rejected
[VAL-SEC-010]: validation-contract.md#val-sec-010-ws-upgrade-with-correct-token-succeeds
[VAL-SEC-011]: validation-contract.md#val-sec-011-ws-upgrade-from-a-foreign-origin-is-rejected
[VAL-SEC-012]: validation-contract.md#val-sec-012-ws-upgrade-from-the-fixture-origin-is-accepted
[VAL-SEC-013]: validation-contract.md#val-sec-013-missing-origin-header-on-cross-protocol-probe-is-rejected
[VAL-SEC-014]: validation-contract.md#val-sec-014-external-interface-connection-refused-by-default
[VAL-SEC-015]: validation-contract.md#val-sec-015-loopback-ss-bind-address-re-check
[VAL-SEC-016]: validation-contract.md#val-sec-016---host-0000-opts-into-wildcard-bind
[VAL-SEC-017]: validation-contract.md#val-sec-017-dev-server-child-process-has-no-shell-ancestor
[VAL-SEC-018]: validation-contract.md#val-sec-018-command-argv-is-parsed-not-shell-evaluated
[VAL-SEC-019]: validation-contract.md#val-sec-019-shell-metacharacters-do-not-trigger-command-injection
[VAL-SEC-020]: validation-contract.md#val-sec-020-deny-write-to-srcsecretenv-extension-mismatch
[VAL-SEC-021]: validation-contract.md#val-sec-021-deny-write-outside-src-path-traversal-sibling
[VAL-SEC-022]: validation-contract.md#val-sec-022-deny-write-via--traversal
[VAL-SEC-023]: validation-contract.md#val-sec-023-allow-write-to-srcindexts-canonical-match
[VAL-SEC-024]: validation-contract.md#val-sec-024-allow-write-to-nested-srcfoobarbazts
[VAL-SEC-025]: validation-contract.md#val-sec-025-root-level-configts-is-governed-by-explicit-pattern
[VAL-SEC-026]: validation-contract.md#val-sec-026-claude-cli-has-no-shell-ancestor
[VAL-SEC-027]: validation-contract.md#val-sec-027-claude-cli-stdin-pipe-no-prompt-file
[VAL-SEC-031]: validation-contract.md#val-sec-031-install-id-is-v4-uuid-not-derived-from-mac
[VAL-SEC-032]: validation-contract.md#val-sec-032-osnetworkinterfaces-not-imported-in-telemetry-path
[VAL-SEC-033]: validation-contract.md#val-sec-033-telemetry-silent-when-optout-set-before-first-flush
[VAL-SEC-034]: validation-contract.md#val-sec-034-api-keys-not-committed-to-repo
[VAL-SEC-035]: validation-contract.md#val-sec-035-api-keys-not-leaked-in-normal-logs
[VAL-SEC-036]: validation-contract.md#val-sec-036-commit-queue-branches-off-from-mainmaster
[VAL-SEC-037]: validation-contract.md#val-sec-037-protected-branch-commit-refused-without-opt-in
[VAL-SEC-038]: validation-contract.md#val-sec-038-commits-on-protected-branch-allowed-when-flag-set
[VAL-SEC-040]: validation-contract.md#val-sec-040-pnpm-testsecurity-runs-all-security-tests
[VAL-SEC-041]: validation-contract.md#val-sec-041-security-test-inventory-documented

[VAL-CROSS-020]: validation-contract.md#val-cross-020
