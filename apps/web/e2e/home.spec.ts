import { expect, test } from "@playwright/test";

test("an unauthenticated visitor to / is redirected to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
