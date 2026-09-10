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
import { expect, test } from "@playwright/test";

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
    // Two buttons carry this name by design: the one above the list, and the
    // call-to-action inside the empty detail pane ("...או צור מוביל חדש").
    // Both open the same blank form; `.first()` is the list-pane one, which
    // is present whether or not anything is selected.
    await page.getByRole("button", { name: "מוביל חדש" }).first().click();
    await page.getByLabel("שם").fill(transporterName);
    await page.getByRole("button", { name: "שמור" }).click();

    await expect(page.getByRole("button", { name: transporterName })).toBeVisible();
    cleanupFns.push(async () => {
      const id = await findCompanyIdByName(transporterName);
      if (id) await deleteTestCompanyById(id);
    });
    cleanupFns.push(async () => {
      const id = await findCompanyIdByName(`${transporterName} (edited)`);
      if (id) await deleteTestCompanyById(id);
    });

    await page.getByRole("button", { name: "ערוך" }).click();
    await page.getByLabel("שם").fill(`${transporterName} (edited)`);
    await page.getByLabel("קבוצת WhatsApp").fill("120363000000000000");
    await page.getByRole("button", { name: "שמור" }).click();

    await expect(page.getByRole("button", { name: `${transporterName} (edited)` })).toBeVisible();
  });
});
