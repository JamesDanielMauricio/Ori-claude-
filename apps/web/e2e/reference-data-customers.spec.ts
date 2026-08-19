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

    const customerName = `E2E Customer ${randomUUID()}`;
    await page.getByRole("button", { name: "לקוח חדש" }).click();
    await page.getByLabel("שם").fill(customerName);
    await page.getByRole("button", { name: "שמור" }).click();

    await expect(page.getByRole("button", { name: customerName })).toBeVisible();
    cleanupFns.push(async () => {
      const id = await findCompanyIdByName(customerName);
      if (id) await deleteTestCompanyById(id);
    });
    cleanupFns.push(async () => {
      const id = await findCompanyIdByName(`${customerName} (edited)`);
      if (id) await deleteTestCompanyById(id);
    });

    await page.getByRole("button", { name: "ערוך" }).click();
    await page.getByLabel("שם").fill(`${customerName} (edited)`);
    await page.getByText("מציג מחירים בהתראות WhatsApp").click();
    await page.getByRole("button", { name: "שמור" }).click();

    await expect(page.getByRole("button", { name: `${customerName} (edited)` })).toBeVisible();
  });
});
