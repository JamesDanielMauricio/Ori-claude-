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
    // Two buttons carry this name by design — the one above the list and the
    // empty detail pane's call-to-action. `.first()` is the list-pane one.
    await page.getByRole("button", { name: "מוצר חדש" }).first().click();
    await page.getByLabel("משפחה").selectOption({ label: family.name });
    await page.getByLabel("זן / שם").fill(productName);
    await page.getByLabel("מחיר", { exact: true }).fill("12.5");
    await page.getByRole("button", { name: "שמור" }).click();

    // The screen never renders "<family> — <variety>" as one string: the
    // detail header puts the variety in an <h2> with the family on its own
    // line beneath, and the list shows them as label and meta. Asserting on
    // the heading also keeps this independent of where the row lands in a
    // list that is now hundreds of products long.
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();
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

    // The badge is rendered bare, without the parentheses this used to look
    // for — and it now appears on every out-of-season product in a seeded
    // catalog, so it has to be read off THIS product's own row.
    await expect(page.getByRole("button", { name: new RegExp(productName) })).toContainText(
      "לא בעונה",
      { timeout: 15000 },
    );
  });
});
