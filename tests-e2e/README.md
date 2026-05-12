# Nova E2E Tests

End-to-end tests for the Nova overlay and proxy, run via Playwright against the Next.js fixture.

## Architecture

- **Fixture** (`/home/upranevich/Projects/Open_source/tests/next-fixture/`) — a minimal Next.js 16 App Router app running on `http://localhost:3500`.
- **Nova proxy** (`http://localhost:3501`) — the Nova dev proxy that injects the overlay into fixture pages.
- **Playwright** — headless Chromium driving assertions against the fixture (direct or through the proxy).

## How Validators Run E2E Tests

Validators must start the fixture and (when needed) Nova **manually** before running Playwright. The `playwright.config.ts` deliberately has **no `webServer` block** to give validators full lifecycle control.

### Step-by-step

#### 1. Start the fixture

```bash
cd /home/upranevich/Projects/Open_source/tests/next-fixture
PORT=3500 pnpm dev &
```

Wait for the fixture to be ready:

```bash
curl -sf --retry 5 --retry-delay 1 http://localhost:3500/
```

#### 2. Start Nova proxy (if your tests need the overlay)

```bash
cd /home/upranevich/Projects/Open_source/tests/next-fixture
NOVA_NON_INTERACTIVE=1 DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
  node /home/upranevich/Projects/Open_source/nova/packages/cli/dist/bin/nova.js \
  --no-open --port=3500 --proxy-port=3501 --yes &
```

Wait for the proxy to be ready:

```bash
curl -sf --retry 5 --retry-delay 1 http://localhost:3501/
```

> **Note:** The `--no-open`, `--yes`, `NOVA_NON_INTERACTIVE=1` flags are added in M1. Until then, validators start only the fixture and run the smoke test which doesn't need Nova.

#### 3. Run the tests

```bash
cd /home/upranevich/Projects/Open_source/nova
pnpm exec playwright test
```

To run only the smoke test:

```bash
pnpm exec playwright test tests-e2e/smoke.spec.ts
```

#### 4. Stop services

```bash
# Stop fixture
lsof -ti :3500 | xargs -r kill -TERM

# Stop Nova proxy (if started)
lsof -ti :3501 | xargs -r kill -TERM
```

## Smoke Test

`smoke.spec.ts` — navigates directly to `http://localhost:3500/` (no Nova proxy needed) and asserts that the fixture's `#add-csv-export` button is visible. This is a fast (< 5 s) confidence check that the fixture boots correctly.

## Adding New Tests

- Import `test` and `expect` from `@playwright/test`.
- For tests that need the overlay, navigate through the proxy: `await page.goto('/')` (uses the configured `baseURL: 'http://localhost:3501'`).
- For tests that bypass the proxy, use an absolute URL: `await page.goto('http://localhost:3500/')`.
- Keep tests focused on one assertion per `test()` block.
- The `browser` fixture gives you a fresh browser context. Use `page.close()` to clean up.
