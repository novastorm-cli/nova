import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests-e2e',

  // Headless chromium only — no firefox/webkit.
  // Validators in CI and locally both run headless.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],

  // Nova proxy (validators start fixture + Nova manually before running e2e).
  // The smoke test navigates directly to the fixture at :3500, not through the proxy.
  // Most overlay tests will navigate through the proxy at :3501.
  use: {
    baseURL: 'http://localhost:3501',
  },

  // No webServer block — validators start the fixture and Nova manually.
  // This keeps the config simple and gives validators full control over
  // the lifecycle (start order, env vars, waiting for readiness, teardown).
});
