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

import { chooseOption } from "./choose-option";

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
  const row = page.locator("tr").filter({ hasText: name });
  try {
    await row.waitFor({ timeout: 8000 });
  } catch {
    await page.reload();
    await row.waitFor({ timeout: 15000 });
  }
}

// The single <tr> currently in inline-edit mode — see the identical helper
// in reference-data-growers.spec.ts for why field lookups need to be
// scoped to it: record-table.tsx's column-visibility picker labels a
// checkbox with each column's own name (e.g. "שם תצוגה"), which collides
// with that same field's input aria-label at the page level.
function editingRow(page: Page) {
  return page.locator("tr").filter({ has: page.getByRole("button", { name: "שמור" }) });
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
    await chooseOption(page.getByRole("combobox", { name: "תפקיד", exact: true }), "מגדל");
    await page.getByLabel("מזהה חברה").fill(targetCompany.id);
    await page.getByRole("button", { name: "צור משתמשים" }).click();

    await expect(page.getByText("נוצר", { exact: true })).toBeVisible();

    // Edit: back on the main Users screen, change display name + role. The
    // row's own pencil icon turns the row itself into the edit form —
    // there's no dialog for this any more, no separate "select the row,
    // then press ערוך" step, and fields are read directly off the page
    // since only one row can be mid-edit at a time.
    await page.goto("/backoffice/users");
    await waitForRowWithReload(page, newUserDisplayName);
    await page
      .locator("tr")
      .filter({ hasText: newUserDisplayName })
      .getByRole("button", { name: "ערוך" })
      .click();
    await editingRow(page).getByLabel("שם תצוגה").fill(`${newUserDisplayName} (edited)`);
    await chooseOption(
      editingRow(page).getByRole("combobox", { name: "תפקיד", exact: true }),
      "לקוח",
    );
    await editingRow(page).getByRole("button", { name: "שמור" }).click();

    const editedRow = page.locator("tr").filter({ hasText: `${newUserDisplayName} (edited)` });
    await expect(editedRow).toBeVisible();

    // Delete, closing the loop on full CRUD for this screen — the row's own
    // trash icon still opens a confirm dialog (unlike editing, a
    // destructive action keeps the extra "are you sure" step).
    await editedRow.getByRole("button", { name: "מחק" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "מחק" }).click();

    await expect(page.locator("tr").filter({ hasText: newUserDisplayName })).toHaveCount(0);
  });
});
