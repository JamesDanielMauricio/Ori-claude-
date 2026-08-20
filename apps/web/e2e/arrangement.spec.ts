import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "@ori/domain/auth/testing";
import {
  initiateBusinessDayInputSchema,
  openShopInputSchema,
  toInitiateBusinessDayRpcArgs,
  toOpenShopRpcArgs,
  toUpdatePickProductPalletsRpcArgs,
  updatePickProductPalletsInputSchema,
} from "@ori/domain/lifecycle-engine";
import {
  createTestGrowerWithProduct,
  createTestOrderProductLine,
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
  getDailyPickForGrower,
  getPickProductLine,
} from "@ori/domain/lifecycle-engine/testing";
import { expect, test } from "@playwright/test";

// Drives the distributor's allocation workspace end to end: the New
// Arrangement wizard creates a record pairing a real grower pick line to a
// real customer order line, the main workspace shows it (pooled
// supply/demand + the records table, in both view modes), and Close
// Arrangement is the terminal action — same headless-RPC-bootstrap
// convention as customer-order.spec.ts/distributor-grower.spec.ts (no
// backoffice UI exists yet for opening/closing the shop itself).
test.describe("Backoffice — arrangement workspace", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("creates an arrangement record via the wizard, shows it in the workspace, and closes the arrangement", async ({ page }) => {
    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const customerCompany = await createTestCompany("Test Customer", "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await adminClient.rpc(
      "initiate_business_day",
      toInitiateBusinessDayRpcArgs(initiateBusinessDayInputSchema.parse({ tradeDate })),
    );
    if (initiate.error) throw initiate.error;
    const dayId = initiate.data!.id;
    cleanupFns.push(() => deleteTestTradingDay(dayId));

    const openShop = await adminClient.rpc(
      "open_shop",
      toOpenShopRpcArgs(openShopInputSchema.parse({ canSeePrices: true })),
    );
    if (openShop.error) throw openShop.error;

    const pick = await getDailyPickForGrower(dayId, grower.companyId);
    const pickLine = await getPickProductLine(pick!.id, grower.varietyId);
    const pickUpdate = await adminClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs(
        updatePickProductPalletsInputSchema.parse({ dailyPickProductId: pickLine!.id, palletsPicked: 10 }),
      ),
    );
    if (pickUpdate.error) throw pickUpdate.error;

    // open_shop already bootstrapped this customer's daily_orders header —
    // createTestOrderProductLine only adds the line.
    await createTestOrderProductLine(dayId, customerCompany.id, grower.varietyId, 6);

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    // --- Pooled supply/demand on the main workspace ---
    await page.goto("/backoffice/arrangement");
    // The variety's total appears in the group header; the same total
    // (this test has exactly one grower/customer) also appears in the
    // per-grower/per-customer breakdown below it — assert the group
    // headers specifically to avoid a strict-mode ambiguity between them.
    await expect(page.getByText("10 משטחים", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("6 משטחים", { exact: false }).first()).toBeVisible();

    // --- New Arrangement wizard ---
    await page.getByRole("link", { name: "+ סידור חדש" }).click();
    await expect(page).toHaveURL(/\/backoffice\/new-arrangement$/);

    // The variety option label is "<family> — <variety>", both random test
    // names — select the only option there is rather than matching text.
    const varietySelect = page.getByLabel("זן");
    const varietyOptionValue = await varietySelect.locator("option").nth(1).getAttribute("value");
    await varietySelect.selectOption(varietyOptionValue!);

    const growerSelect = page.getByLabel("מגדל (קו ליקוט)");
    await expect(growerSelect.locator("option")).toHaveCount(2); // placeholder + one grower line
    const growerOptionValue = await growerSelect.locator("option").nth(1).getAttribute("value");
    await growerSelect.selectOption(growerOptionValue!);

    const customerSelect = page.getByLabel("לקוח (קו הזמנה)");
    const customerOptionValue = await customerSelect.locator("option").nth(1).getAttribute("value");
    await customerSelect.selectOption(customerOptionValue!);

    await page.getByLabel("כמות (משטחים)").fill("5");
    // `exact` because the sidebar's always-present Business Day Panel carries
    // a "לקוחות מורשים רואים מחירים" checkbox, and getByLabel matches on
    // substring — same collision reference-data-products.spec.ts handles.
    await page.getByLabel("מחיר", { exact: true }).fill("12.5");

    await page.getByRole("button", { name: "צור רשומת סידור" }).click();
    await expect(page.getByText("הרשומה נוצרה.")).toBeVisible();

    // --- Back on the main workspace: the new record is visible ---
    await page.goto("/backoffice/arrangement");
    await expect(page.getByRole("cell", { name: "5", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "12.5", exact: true })).toBeVisible();

    // Toggling the view mode re-sorts the same underlying records table —
    // it must still show the one record, not clear it.
    await page.getByRole("button", { name: "לפי מגדל" }).click();
    await expect(page.getByRole("cell", { name: "5", exact: true })).toBeVisible();

    // --- Close Arrangement: blocked until the shop is closed ---
    const closeButton = page.getByRole("button", { name: "סגור סידור ←" });
    await expect(closeButton).toBeDisabled();

    const closeShop = await adminClient.rpc("close_shop");
    if (closeShop.error) throw closeShop.error;

    await page.reload();
    await expect(closeButton).toBeEnabled();
    await closeButton.click();
    await expect(page.getByText("הסידור נסגר.")).toBeVisible();

    // Once the day reaches phase "closed", it drops out of the workspace's
    // "currently active day" query — same convention as
    // distributor-grower's own open-day query (`neq("phase", "closed")`).
    // The empty state is itself proof the close committed, on top of the
    // success toast above.
    await expect(page.getByText("אין יום מסחר פתוח כרגע.")).toBeVisible();
  });
});
