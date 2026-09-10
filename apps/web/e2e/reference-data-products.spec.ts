import { randomUUID } from "node:crypto";

import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
} from "@ori/domain/auth/testing";
import {
  createTestCustomerCompany,
  createTestProductFamily,
  deleteTestCompany as deleteTestCompanyById,
  deleteTestProductFamily,
  deleteTestProductVariety,
  findProductVarietyIdByName,
} from "@ori/domain/reference-data/testing";
import { expect, test, type Page } from "@playwright/test";

// The single <tr> currently in inline-edit mode — see the identical helper
// in reference-data-growers.spec.ts for why field lookups need to be
// scoped to it: record-table.tsx's column-visibility picker labels a
// checkbox with each column's own name (e.g. "מחיר"), which collides with
// that same field's input aria-label at the page level.
function editingRow(page: Page) {
  return page.locator("tr").filter({ has: page.getByRole("button", { name: "שמור" }) });
}

// Drives the Products screen through the browser — a create and an edit
// through the real form and `save_product` RPC, including the overbooking
// field and the seasonal-availability flag.
test.describe("Backoffice — Products", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("creates a product, then edits its price, overbooking buffer, seasonal flag, and per-customer cap", async ({
    page,
  }) => {
    const capCustomer = await createTestCustomerCompany(`E2E Cap Customer ${randomUUID()}`);
    cleanupFns.push(() => deleteTestCompanyById(capCustomer.id));

    const family = await createTestProductFamily();
    cleanupFns.push(() => deleteTestProductFamily(family.id));

    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.goto("/backoffice/products");

    const productName = `E2E Variety ${randomUUID()}`;
    // The table's own toolbar add button (record-table.tsx's `onAdd`)
    // prepends a draft row, already in inline-edit mode — one button now,
    // not the old list-button-plus-empty-pane-button pair, so no
    // `.first()` disambiguation needed.
    await page.getByRole("button", { name: "מוצר חדש" }).click();
    await editingRow(page).getByLabel("משפחה").selectOption({ label: family.name });
    await editingRow(page).getByLabel("זן / שם").fill(productName);
    await editingRow(page).getByLabel("מחיר", { exact: true }).fill("12.5");
    await editingRow(page).getByRole("button", { name: "שמור" }).click();

    const productRow = page.locator("tr").filter({ hasText: productName });
    await expect(productRow).toBeVisible();
    cleanupFns.push(async () => {
      const id = await findProductVarietyIdByName(productName);
      if (id) await deleteTestProductVariety(id);
    });

    // Edit: bump the overbooking buffer and turn off seasonal availability
    // — both real PRD fields (product-catalog-family-and-variety.md's "No
    // Overbooking") this screen is the only place that can change. The
    // row's own pencil icon turns the row itself into the edit form, so
    // the rest of this step reads fields directly off the page — safe
    // since only one row can be mid-edit at a time.
    await productRow.getByRole("button", { name: "ערוך" }).click();
    await editingRow(page).getByLabel("חריגת הזמנה מותרת (No Overbooking)").fill("3");
    await editingRow(page).getByLabel("זמין בעונה הנוכחית").click();

    // The per-customer pallet caps are their own column, edited through
    // that cell's popover (portaled out of the table's scroll container).
    // This is the only screen that writes product_customer_caps, and this
    // is the only test that covers that half of `save_product`.
    await editingRow(page).getByRole("button", { name: "תקרות משטחים ללקוח" }).click();
    const capsPanel = page.getByRole("dialog", { name: "תקרות משטחים ללקוח" });
    await capsPanel.getByRole("button", { name: "הוסף תקרה" }).click();
    await capsPanel.getByLabel("לקוח").selectOption({ label: capCustomer.name });
    await capsPanel.getByLabel("תקרת משטחים").fill("4");
    // Closes the popover only — the row keeps its other unsaved edits (see
    // the same step in reference-data-growers.spec.ts).
    await page.keyboard.press("Escape");

    await editingRow(page).getByRole("button", { name: "שמור" }).click();

    // The "בעונה"/"לא בעונה" column is its own cell now, not a badge glued
    // to the row's clickable name — and it appears on every out-of-season
    // product in a seeded catalog, so it has to be read off THIS product's
    // own row.
    await expect(productRow).toContainText("לא בעונה", { timeout: 15000 });
    // …and the cap is readable straight off the row too, with nothing
    // expanded or opened.
    await expect(productRow).toContainText(`${capCustomer.name}: 4`);
  });
});
