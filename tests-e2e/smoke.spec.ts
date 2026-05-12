import { test, expect } from '@playwright/test';

test('fixture boots → page loads → button visible', async ({ browser }) => {
  // Navigate directly to the fixture (no Nova proxy required for the smoke).
  // Other e2e tests will use page.goto('/') relative to baseURL (the proxy).
  const page = await browser.newPage();
  await page.goto('http://localhost:3500/');

  // The fixture's #add-csv-export button must be visible on the page.
  const button = page.locator('#add-csv-export');
  await expect(button).toBeVisible();

  await page.close();
});
