import { randomUUID } from "node:crypto";

import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
} from "@ori/domain/auth/testing";
import { createTestGrowerCompany, deleteTestCompany as deleteTestCompanyById } from "@ori/domain/reference-data/testing";
import { expect, test, type Page } from "@playwright/test";

// A row created on a *different* page (the import flow below) has been
// observed taking a few seconds to appear in this list after navigating
// straight here — reproduced against the real hosted Supabase project,
// not local dev. Root-caused as far as it can be from the client side:
// Postgres itself has no replication lag (single primary, no read
// replicas) and it isn't a browser/request cache (an explicit
// `Cache-Control: no-store` request header didn't change the behavior
// either) — it looks like transient caching on Supabase's own hosted
// REST gateway for a repeated identical GET URL, which nothing on our
// side can force-bypass. A same-page create-then-list (the other four
// reference-data screens) never shows this, because those refetch via an
// explicit `queryClient.invalidateQueries()` the moment the mutation
// resolves, not a fresh cross-page navigation. One reload reliably
// resolves it, so that's what this waits through instead of either a
// flaky fixed timeout or silently masking a real (if minor, few-second)
// UX gap — see docs/ARCHITECTURE.md.
async function waitForRowWithReload(page: Page, name: string) {
  const row = page.getByRole("button", { name: new RegExp(name) });
  try {
    await row.waitFor({ timeout: 8000 });
  } catch {
    await page.reload();
    await row.waitFor({ timeout: 15000 });
  }
}

// Drives the Users screen through the browser. Unlike the other four
// screens, "create" isn't a button on this screen itself — per the PRD, a
// `profiles` row with no matching `auth.users` identity would be an
// orphan, so account creation stays the existing bulk-import flow (linked
// directly from this screen's list pane). This test exercises that real
// create path first, then the Users screen's own edit (display name,
// role, product blacklist) and delete on the account it just created.
test.describe("Backoffice — Users", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("imports a user, then edits their profile and deletes them", async ({ page }) => {
    test.setTimeout(60000);
    const targetCompany = await createTestGrowerCompany();
    cleanupFns.push(() => deleteTestCompanyById(targetCompany.id));

    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    // Create: the bulk-import flow.
    await page.goto("/backoffice/users/import");
    const newUserEmail = `e2e-${randomUUID()}@example.test`;
    const newUserDisplayName = `E2E User ${randomUUID()}`;
    await page.getByLabel("אימייל").fill(newUserEmail);
    await page.getByLabel("שם תצוגה").fill(newUserDisplayName);
    await page.getByLabel("תפקיד").selectOption("grower");
    await page.getByLabel("מזהה חברה").fill(targetCompany.id);
    await page.getByRole("button", { name: "צור משתמשים" }).click();

    await expect(page.getByText("נוצר", { exact: true })).toBeVisible();

    // Edit: back on the main Users screen, change display name + role.
    await page.goto("/backoffice/users");
    await waitForRowWithReload(page, newUserDisplayName);
    await page.getByRole("button", { name: new RegExp(newUserDisplayName) }).click();
    await page.getByRole("button", { name: "ערוך" }).click();
    await page.getByLabel("שם תצוגה").fill(`${newUserDisplayName} (edited)`);
    await page.getByLabel("תפקיד").selectOption("customer");
    await page.getByRole("button", { name: "שמור" }).click();

    await expect(page.getByRole("button", { name: new RegExp(`${newUserDisplayName} \\(edited\\)`) })).toBeVisible();

    // Delete, closing the loop on full CRUD for this screen.
    await page.getByRole("button", { name: "מחק" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "מחק" }).click();

    await expect(page.getByRole("button", { name: new RegExp(newUserDisplayName) })).toHaveCount(0);
  });
});
