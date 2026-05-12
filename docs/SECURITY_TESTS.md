# Nova Security Test Inventory

This document catalogs the security regression test suite for Novastorm v1.0.0. All tests are located under `packages/*/src/__tests__/security/` and are run together via `pnpm test:security`.

**Total: 106 test cases across 6 files** (all passing as of v1.0.0)

---

## Quick Reference

```bash
# Run only security tests
pnpm test:security

# Security tests are also included in the main test run
pnpm test
```

---

## Test Catalog

### 1. WebSocket Authentication & Origin Checks
**File:** `packages/proxy/src/__tests__/security/ws-auth.test.ts`  
**Tests:** 15  
**Covers:** Per-session token generation, HTML injection of session token, WS upgrade auth (token + Origin), constant-time token comparison.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `generates a 64-char hex session token` | Session token is crypto-random, 64 hex chars |
| 2 | `session tokens are unique across generations` | Each call produces a different token |
| 3 | `proxied HTML contains data-nova-session matching the token` | Token is embedded in injected overlay `<script>` tag |
| 4 | `proxied HTML does NOT contain session token when not set` | No `data-nova-session` attribute when token not configured |
| 5 | `WS upgrade without token returns 401` | WS handshake with no token → HTTP 401 |
| 6 | `WS upgrade with wrong token returns 401` | WS handshake with bogus token → HTTP 401 |
| 7 | `WS upgrade with correct token and valid Origin returns 101` | Happy path: valid token + valid Origin → 101 Switching Protocols |
| 8 | `WS upgrade with correct token but foreign Origin returns 403` | Valid token but spoofed Origin → HTTP 403 |
| 9 | `WS upgrade with correct token and Origin 127.0.0.1:<proxyPort> succeeds` | Loopback IP Origin is accepted |
| 10 | `WS upgrade with correct token but no Origin header returns 401` | Missing Origin header → HTTP 401 |
| 11 | `WebSocket connects successfully with correct token and Origin` | Full ws library handshake succeeds |
| 12 | `WebSocket fails to connect without token` | ws library handshake with no token → rejected |
| 13 | `WebSocket fails to connect with wrong token` | ws library handshake with bogus token → rejected |
| 14 | `WebSocket fails to connect with wrong Origin` | ws library handshake with spoofed Origin → rejected |
| 15 | `token comparison is constant-time (timingSafeEqual used)` | Uses `crypto.timingSafeEqual` to prevent timing attacks |

**Validation assertions:** VAL-SEC-004, VAL-SEC-005, VAL-SEC-006, VAL-SEC-007, VAL-SEC-008, VAL-SEC-009, VAL-SEC-010, VAL-SEC-011, VAL-SEC-012, VAL-SEC-013

---

### 2. DevServer Command Injection Prevention
**File:** `packages/proxy/src/__tests__/security/devserver-no-shell.test.ts`  
**Tests:** 23  
**Covers:** Shell metacharacter injection rejection, valid command acceptance, shell-quote parsing, `shell: false` enforcement.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `should reject && (shell AND operator)` | `command1 && command2` → rejected |
| 2 | `should reject \| (shell pipe)` | `command1 \| command2` → rejected |
| 3 | `should reject > (output redirect)` | Output redirection → rejected |
| 4 | `should reject < (input redirect)` | Input redirection → rejected |
| 5 | `should reject $HOME (variable expansion)` | Shell variable expansion → rejected |
| 6 | `should reject ${VAR} syntax` | Braced variable expansion → rejected |
| 7 | `should reject backtick command substitution` | Backtick substitution → rejected |
| 8 | `should reject ; (command separator)` | Semicolon command chaining → rejected |
| 9 | `should reject \|\| (shell OR operator)` | Shell OR chaining → rejected |
| 10 | `should reject glob patterns` | Shell glob expansion → rejected |
| 11 | `should accept simple command with no shell metacharacters` | Clean commands spawn with `shell: false` |
| 12 | `should accept pnpm dev command` | `pnpm dev` parsed as `['dev']` |
| 13 | `should accept npm run dev command` | `npm run dev` parsed as `['run', 'dev']` |
| 14 | `should properly parse double-quoted arguments` | Double-quoted args preserved |
| 15 | `should properly parse single-quoted arguments` | Single-quoted args preserved |
| 16 | `should pass cwd to spawn` | Working directory forwarded to spawn |
| 17 | `should pass env to spawn with PORT` | PORT env var forwarded |
| 18 | `should set shell to false` | `shell: false` in spawn options |
| 19 | `should include guidance in the error message` | Error messages include remediation hint |
| 20 | `should name the error InvalidCommandError` | Custom error type with descriptive name |
| 21 | `should reject empty command` | Empty string → rejected |
| 22 | `should reject whitespace-only command` | Whitespace-only → rejected |
| 23 | `should accept command with escaped dollar sign (literal)` | `\\$HOME` preserved as literal, not expanded |

**Validation assertions:** VAL-SEC-017, VAL-SEC-018, VAL-SEC-019

---

### 3. Proxy Host Binding
**File:** `packages/proxy/src/__tests__/security/bind.test.ts`  
**Tests:** 9  
**Covers:** Default loopback binding, wildcard opt-in, IPv6 loopback, EADDRINUSE rejection.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `binds to 127.0.0.1 by default` | Default bind is loopback only |
| 2 | `binds to 0.0.0.0 when host is set via setHost()` | `setHost('0.0.0.0')` → wildcard bind |
| 3 | `binds to 0.0.0.0 when host is passed as parameter to start()` | `start(..., '0.0.0.0')` → wildcard bind |
| 4 | `setHost() with 127.0.0.1 confirms loopback bind` | Explicit loopback → confirmed |
| 5 | `start parameter overrides setHost()` | Per-call host overrides stored value |
| 6 | `binds to ::1 when host is set to IPv6 loopback` | IPv6 loopback support |
| 7 | `rejects EADDRINUSE when port is in use` | Port conflict → clear error |
| 8 | `getHttpServer() returns server with correct host and port` | Server address inspection |
| 9 | `server address reflects wildcard when host is 0.0.0.0` | Wildcard address reporting |

**Validation assertions:** VAL-SEC-001, VAL-SEC-002, VAL-SEC-003, VAL-SEC-014, VAL-SEC-015, VAL-SEC-016

---

### 4. PathGuard Boundary Enforcement
**File:** `packages/core/src/__tests__/security/path-guard.test.ts`  
**Tests:** 27  
**Covers:** Path traversal prevention, writable boundary enforcement with picomatch, readonly/ignored precedence, nested glob correctness.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `allows project root and subdirectories without prompt` | Project-scoped writes are allowed |
| 2 | `allows .nova/ without prompt` | `.nova/` directory is always writable |
| 3 | `throws PathTraversalError for paths outside project root` | `/etc/passwd` → PathTraversalError |
| 4 | `does not prompt for subdirectories of project root` | Deep subdirectory writes allowed |
| 5 | `parent allow covers children` | Explicit allow on parent dir → children allowed |
| 6 | `validate() accepts all paths under project root` | Validation passes for project paths |
| 7 | `throws PathTraversalError for check() on paths outside root` | Absolute outside paths → rejected |
| 8 | `denies src/secret.env when writable is src/**/*.ts` | Extension mismatch → denied |
| 9 | `allows src/index.ts when writable is src/**/*.ts` | Canonical match → allowed |
| 10 | `allows src/foo/bar/baz.ts when writable is src/**/*.ts` | Deep nested match → allowed |
| 11 | `denies root.ts when writable is src/**/*.ts` | Outside src/ prefix → denied |
| 12 | `denies ../secret.txt when writable is src/**/*.ts` | Path traversal via `..` → denied |
| 13 | `denies /etc/passwd (absolute outside root)` | Absolute path outside root → rejected |
| 14 | `allows root-level tailwind.config.ts when writable includes *.config.ts` | Root-level pattern match |
| 15 | `denies src/foo.ts when writable is only *.config.ts` | No matching pattern → denied |
| 16 | `allows files matching any of multiple writable patterns` | Multi-pattern OR logic |
| 17 | `denies files not matching any writable pattern when writable is set` | No matching patterns → denied |
| 18 | `still allows .nova/ files even when writable boundaries are set` | `.nova/` exemption |
| 19 | `correctly handles nested glob patterns without collapsing` | `src/**/*.ts` ≠ `src/` (picomatch, not collapse) |
| 20 | `isReadonly takes precedence over writable for overlapping patterns` | Readonly overrides writable |
| 21 | `isIgnored takes precedence over writable` | Ignored overrides writable |
| 22 | `no writable boundaries set -> old prompt-based logic works` | Fallback to prompt-based allow |
| 23 | `denies readonly files on check()` | Readonly → PathDeniedError |
| 24 | `denies ignored files on check()` | Ignored → PathDeniedError |
| 25 | `identifies readonly files` | `isReadonly()` correctness |
| 26 | `identifies ignored files` | `isIgnored()` correctness |
| 27 | `allows files not in boundaries` | Unrestricted files pass through |

**Validation assertions:** VAL-SEC-020, VAL-SEC-021, VAL-SEC-022, VAL-SEC-023, VAL-SEC-024, VAL-SEC-025

---

### 5. Secret Redaction
**File:** `packages/core/src/__tests__/security/redact.test.ts`  
**Tests:** 21  
**Covers:** Redaction of 8+ key patterns (OpenAI, Anthropic, DeepSeek, OpenRouter, GitHub, Google, HuggingFace, xAI), edge cases, context object redaction.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `should redact generic sk- keys (OpenAI style)` | `sk-proj-...` → `sk-***` |
| 2 | `should redact Anthropic sk-ant- keys` | `sk-ant-api03-...` → `sk-ant-***` |
| 3 | `should redact DeepSeek sk-deepseek- keys` | `sk-deepseek-...` → `sk-deepseek-***` |
| 4 | `should redact OpenRouter sk-or- keys` | `sk-or-v1-...` → `sk-or-***` |
| 5 | `should redact GitHub OAuth tokens (gho_)` | `gho_...` → `gho_***` |
| 6 | `should redact Google API keys (AIza)` | `AIza...` → `AIza***` |
| 7 | `should redact HuggingFace tokens (hf_)` | `hf_...` → `hf_***` |
| 8 | `should redact xAI / Grok keys (xai-)` | `xai-...` → `xai-***` |
| 9 | `should leave normal text unchanged` | Non-secret text passes through |
| 10 | `should leave short sk- tokens unchanged (false positives)` | Short `sk-` strings not redacted |
| 11 | `should leave placeholder keys unchanged` | Doc/test placeholders not redacted |
| 12 | `should redact multiple keys in one string` | Two different keys both redacted |
| 13 | `should redact keys in JSON strings` | Keys inside JSON values redacted |
| 14 | `should redact keys in Authorization headers` | Bearer token redaction |
| 15 | `should handle empty string` | Empty input → empty output |
| 16 | `should handle string with only whitespace` | Whitespace preserved |
| 17 | `should handle key at start of string` | Leading key redacted |
| 18 | `should handle key at end of string` | Trailing key redacted |
| 19 | `should redact string values containing keys` | `redactContext()` string value redaction |
| 20 | `should handle empty context` | Empty object → empty object |
| 21 | `should not mutate the original object` | Immutability of `redactContext()` |

**Related source:** `packages/core/src/security/redact.ts`

---

### 6. Claude CLI Provider No-Shell
**File:** `packages/core/src/__tests__/security/claude-cli.test.ts`  
**Tests:** 11  
**Covers:** No-shell spawn (spawns `claude` directly, not `sh`), stdin pipe, vision rejection, error handling.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `throws ProviderError with code NO_VISION_SUPPORT` | `chatWithVision()` → clear ProviderError |
| 2 | `never silently degrades with screenshot-capture note` | No silent fallback on vision attempts |
| 3 | `does not call spawn for chatWithVision (throws immediately)` | Vision rejection is synchronous, no spawn |
| 4 | `spawns "claude" directly, not "sh"` | `spawn('claude', args)` — no shell wrapper |
| 5 | `writes the prompt to stdin and closes it` | Prompt piped via stdin, not temp files |
| 6 | `yields text chunks from stdout` | Streaming output correctly parsed |
| 7 | `throws ProviderError on non-zero exit code` | Exit code 1 → ProviderError |
| 8 | `throws ProviderError with ENOENT hint when claude not found` | Missing binary → clear error |
| 9 | `does not use temp files (spawns claude with prompt on stdin)` | No temp file creation |
| 10 | `returns concatenated stream chunks` | `chat()` aggregates stream output |
| 11 | `passes responseFormat=json as a suffix instruction on stdin` | JSON mode instruction forwarded |

**Validation assertions:** VAL-SEC-026, VAL-SEC-027

---

## Running the Security Suite

```bash
# Run all security tests
pnpm test:security

# Run a specific security test file
pnpm exec vitest run packages/proxy/src/__tests__/security/ws-auth.test.ts

# Security tests are included in the main suite
pnpm test
```

## Adding New Security Tests

When adding a new security test:

1. Place it in the appropriate `packages/<pkg>/src/__tests__/security/` directory
2. Name the file descriptively (e.g., `csp.test.ts`, `commit-safety.test.ts`)
3. Follow the existing pattern: one `describe` per feature area, clear `it` descriptions
4. Run `pnpm test:security` to verify
5. Update this document with the new test catalog entry
