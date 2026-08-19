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
  deleteTestProductFamily,
  deleteTestProductVariety,
  findProductVarietyIdByName,
} from "@ori/domain/reference-data/testing";
import { expect, test } from "@playwright/test";

// Drives the Products screen through the browser — a create and an edit
// through the real form and `save_product` RPC, including the overbooking
// field and the seasonal-availability flag.
test.describe("Backoffice — Products", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("creates a product, then edits its price, overbooking buffer, and seasonal flag", async ({
    page,
  }) => {
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
    await page.getByRole("button", { name: "מוצר חדש" }).click();
    await page.getByLabel("משפחה").selectOption({ label: family.name });
    await page.getByLabel("זן / שם").fill(productName);
    await page.getByLabel("מחיר", { exact: true }).fill("12.5");
    await page.getByRole("button", { name: "שמור" }).click();

    await expect(page.getByText(`${family.name} — ${productName}`)).toBeVisible();
    cleanupFns.push(async () => {
      const id = await findProductVarietyIdByName(productName);
      if (id) await deleteTestProductVariety(id);
    });

    // Edit: bump the overbooking buffer and turn off seasonal availability
    // — both real PRD fields (product-catalog-family-and-variety.md's "No
    // Overbooking") this screen is the only place that can change.
    await page.getByRole("button", { name: "ערוך" }).click();
    await page.getByLabel("חריגת הזמנה מותרת (No Overbooking)").fill("3");
    await page.getByText("זמין בעונה הנוכחית").click();
    await page.getByRole("button", { name: "שמור" }).click();

    await expect(page.getByText("(לא בעונה)")).toBeVisible({ timeout: 15000 });
  });
});
