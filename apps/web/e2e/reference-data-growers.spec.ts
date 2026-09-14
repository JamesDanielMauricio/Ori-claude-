import { randomUUID } from "node:crypto";

import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
} from "@ori/domain/auth/testing";
import {
  createTestProductFamily,
  createTestProductVariety,
  deleteTestCompany as deleteTestCompanyById,
  deleteTestProductFamily,
  deleteTestProductVariety,
  findCompanyIdByName,
} from "@ori/domain/reference-data/testing";
import { expect, test, type Page } from "@playwright/test";

import { chooseOption } from "./choose-option";

// The single <tr> currently in inline-edit mode — identified by carrying
// the row's own "שמור" button, which only ever exists on one row at a
// time. Field lookups are scoped to it rather than done at the page level
// because record-table.tsx's column-visibility picker renders a checkbox
// per column labelled with that column's own name (e.g. "שם"), which is
// also literally every field's own aria-label — an unscoped
// `page.getByLabel("שם")` matches both and Playwright refuses the
// ambiguity. The in-season checklist below lives in the row's separate
// expand-panel <tr> (not this one), so it stays looked up at the page
// level — nothing there collides with a column name.
function editingRow(page: Page) {
  return page.locator("tr").filter({ has: page.getByRole("button", { name: "שמור" }) });
}

// Drives the Growers screen through the browser end to end — a create and
// an edit, both through the real form and `save_grower` RPC, not a direct
// DB write. The in-season checkbox toggle exercises the join-table half
// of that RPC's transactional replace, not just the company row.
test.describe("Backoffice — Growers", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("creates a grower, then edits its name, in-season product selection, and assigned transporter", async ({ page }) => {
    const family = await createTestProductFamily();
    cleanupFns.push(() => deleteTestProductFamily(family.id));
    const product = await createTestProductVariety({ familyId: family.id, name: `E2E Variety ${randomUUID()}` });
    cleanupFns.push(() => deleteTestProductVariety(product.id));
    const transporter = await createTestCompany(`E2E Transporter ${randomUUID()}`, "transporter");
    cleanupFns.push(() => deleteTestCompany(transporter.id));

    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.goto("/backoffice/growers");

    const growerName = `E2E Grower ${randomUUID()}`;
    // The table's own toolbar add button (record-table.tsx's `onAdd`)
    // prepends a draft row, already in inline-edit mode — no dialog. Only
    // one such button now (unlike the old list-plus-empty-pane layout,
    // which duplicated it), so no `.first()` disambiguation is needed.
    await page.getByRole("button", { name: "מגדל חדש" }).click();
    await editingRow(page).getByLabel("שם").fill(growerName);
    await editingRow(page).getByRole("button", { name: "שמור" }).click();

    const growerRow = page.locator("tr").filter({ hasText: growerName });
    await expect(growerRow).toBeVisible();
    cleanupFns.push(async () => {
      const id = await findCompanyIdByName(growerName);
      if (id) await deleteTestCompanyById(id);
    });
    cleanupFns.push(async () => {
      const id = await findCompanyIdByName(`${growerName} (edited)`);
      if (id) await deleteTestCompanyById(id);
    });

    // Edit: rename, add the fixture product to the in-season selection,
    // and assign the fixture transporter (id 8's cc target on arrangement
    // finalization — this is the only screen that can set it). The row's
    // own pencil icon turns the row itself into the edit form; once
    // clicked, `growerRow`'s text no longer contains the (now-input-held)
    // name, so the rest of this step reads fields directly off the page —
    // safe since only one row can be mid-edit at a time.
    await growerRow.getByRole("button", { name: "ערוך" }).click();
    await editingRow(page).getByLabel("שם").fill(`${growerName} (edited)`);

    // The in-season list is its own column; editing it opens that cell's
    // popover (portaled out of the table's scroll container), which carries
    // a filter because the catalog is ~600 varieties deep.
    await editingRow(page).getByRole("button", { name: "מוצרים בעונה" }).click();
    const picker = page.getByRole("dialog", { name: "מוצרים בעונה" });
    await picker.getByLabel("סינון מוצרים בעונה").fill(product.name);
    await picker.getByText(`${family.name} — ${product.name}`).click();
    // Escape closes the picker only — the row stays in edit mode with the
    // rest of its unsaved changes intact (cell-popover.tsx stops the key
    // from reaching the table's own cancel-the-row handler). If that ever
    // regressed, the save below would have nothing left to save.
    await page.keyboard.press("Escape");

    await chooseOption(
      editingRow(page).getByRole("combobox", { name: "מוביל", exact: true }),
      transporter.name,
    );
    await editingRow(page).getByRole("button", { name: "שמור" }).click();

    const editedRow = page.locator("tr").filter({ hasText: `${growerName} (edited)` });
    await expect(editedRow).toBeVisible();
    // The in-season selection is readable straight off the row now, with
    // nothing expanded — the whole point of the column.
    await expect(editedRow).toContainText(`${family.name} — ${product.name}`);

    await page.reload();
    await page
      .locator("tr")
      .filter({ hasText: `${growerName} (edited)` })
      .getByRole("button", { name: "ערוך" })
      .click();
    await expect(
      editingRow(page).getByRole("combobox", { name: "מוביל", exact: true }),
    ).toHaveText(transporter.name);
  });
});
