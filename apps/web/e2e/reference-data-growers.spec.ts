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
import { expect, test } from "@playwright/test";

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
    // Two buttons carry this name by design — the one above the list and the
    // empty detail pane's call-to-action. `.first()` is the list-pane one.
    await page.getByRole("button", { name: "מגדל חדש" }).first().click();
    await page.getByLabel("שם").fill(growerName);
    await page.getByRole("button", { name: "שמור" }).click();

    await expect(page.getByRole("button", { name: growerName })).toBeVisible();
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
    // finalization — this is the only screen that can set it).
    await page.getByRole("button", { name: "ערוך" }).click();
    await page.getByLabel("שם").fill(`${growerName} (edited)`);
    await page.getByText(`${family.name} — ${product.name}`).click();
    await page.getByLabel("מוביל").selectOption(transporter.id);
    await page.getByRole("button", { name: "שמור" }).click();

    await expect(page.getByRole("button", { name: `${growerName} (edited)` })).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: `${growerName} (edited)` }).click();
    await expect(page.getByLabel("מוביל")).toHaveValue(transporter.id);
  });
});
