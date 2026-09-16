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

// Drives the Customers screen through the browser — a create and an edit
// through the real form and `save_customer` RPC.
test.describe("Backoffice — Customers", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("creates a customer, then edits its name and price-visibility setting", async ({ page }) => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.goto("/backoffice/customers");

    const customerName = `לקוח E2E ${randomUUID()}`;
    // The table's own toolbar add button (record-table.tsx's `onAdd`)
    // prepends a draft row, already in inline-edit mode — one button now,
    // so no `.first()` disambiguation needed.
    await page.getByRole("button", { name: "לקוח חדש" }).click();
    await editingRow(page).getByLabel("שם").fill(customerName);
    await editingRow(page).getByRole("button", { name: "שמור" }).click();

    const customerRow = page.locator("tr").filter({ hasText: customerName });
    await expect(customerRow).toBeVisible();
    cleanupFns.push(async () => {
      const id = await findCompanyIdByName(customerName);
      if (id) await deleteTestCompanyById(id);
    });
    cleanupFns.push(async () => {
      const id = await findCompanyIdByName(`${customerName} (edited)`);
      if (id) await deleteTestCompanyById(id);
    });

    // The row's own pencil icon turns the row itself into the edit form,
    // so the rest of this step reads fields directly off the page — safe
    // since only one row can be mid-edit at a time.
    await customerRow.getByRole("button", { name: "ערוך" }).click();
    await editingRow(page).getByLabel("שם").fill(`${customerName} (edited)`);
    // The checkbox itself carries this as its aria-label now (not a
    // wrapping <label> with static instructional text), so getByLabel
    // finds and toggles it directly.
    await editingRow(page).getByLabel("מציג מחירים בהתראות").click();
    await editingRow(page).getByRole("button", { name: "שמור" }).click();

    await expect(page.locator("tr").filter({ hasText: `${customerName} (edited)` })).toBeVisible();
  });
});
