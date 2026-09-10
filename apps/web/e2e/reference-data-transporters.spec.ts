import { randomUUID } from "node:crypto";

import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
} from "@ori/domain/auth/testing";
import {
  deleteTestCompany as deleteTestCompanyById,
  findCompanyIdByName,
} from "@ori/domain/reference-data/testing";
import { expect, test, type Page } from "@playwright/test";

// The single <tr> currently in inline-edit mode — see the identical helper
// in reference-data-growers.spec.ts for why field lookups need to be
// scoped to it: record-table.tsx's column-visibility picker labels a
// checkbox with each column's own name, which collides with that same
// field's input aria-label at the page level.
function editingRow(page: Page) {
  return page.locator("tr").filter({ has: page.getByRole("button", { name: "שמור" }) });
}

// Drives the Transporters screen through the browser — a create and an
// edit through the real form and `save_transporter` RPC.
test.describe("Backoffice — Transporters", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("creates a transporter, then edits its name and WhatsApp group", async ({ page }) => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.goto("/backoffice/transporters");

    const transporterName = `E2E Transporter ${randomUUID()}`;
    // The table's own toolbar add button (record-table.tsx's `onAdd`)
    // prepends a draft row, already in inline-edit mode — one button now,
    // so no `.first()` disambiguation needed.
    await page.getByRole("button", { name: "מוביל חדש" }).click();
    await editingRow(page).getByLabel("שם").fill(transporterName);
    await editingRow(page).getByRole("button", { name: "שמור" }).click();

    const transporterRow = page.locator("tr").filter({ hasText: transporterName });
    await expect(transporterRow).toBeVisible();
    cleanupFns.push(async () => {
      const id = await findCompanyIdByName(transporterName);
      if (id) await deleteTestCompanyById(id);
    });
    cleanupFns.push(async () => {
      const id = await findCompanyIdByName(`${transporterName} (edited)`);
      if (id) await deleteTestCompanyById(id);
    });

    // The row's own pencil icon turns the row itself into the edit form,
    // so the rest of this step reads fields directly off the page — safe
    // since only one row can be mid-edit at a time.
    await transporterRow.getByRole("button", { name: "ערוך" }).click();
    await editingRow(page).getByLabel("שם").fill(`${transporterName} (edited)`);
    await editingRow(page).getByLabel("קבוצת WhatsApp").fill("120363000000000000");
    await editingRow(page).getByRole("button", { name: "שמור" }).click();

    await expect(
      page.locator("tr").filter({ hasText: `${transporterName} (edited)` }),
    ).toBeVisible();
  });
});
