// A Playwright test of the app. The audit must never read it either.
import { expect, test } from "@playwright/test";

test("home page", async ({ page }) => {
  await page.goto("/");
  await page.setContent('<img src="/images/decoy-from-a-playwright-test.png" data-decoy="PLAYWRIGHT-TEST-DECOY">');
  await expect(page.locator("h1")).toBeVisible();
});
