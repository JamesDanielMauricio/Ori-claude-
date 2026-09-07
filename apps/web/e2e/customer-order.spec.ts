import { db } from "@ori/db";
import { growerProducts } from "@ori/db/schema";
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
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
  getDailyPickForGrower,
  getPickProductLine,
} from "@ori/domain/lifecycle-engine/testing";
import { createTestProductVariety, deleteTestProductVariety } from "@ori/domain/reference-data/testing";
import { expect, test } from "@playwright/test";

// Drives the customer's browse/order/history screens end to end. The
// trading day, shop, and grower supply are all bootstrapped headlessly via
// the real lifecycle/grower RPCs (initiate_business_day, open_shop,
// update_pick_product_pallets) — there is no backoffice UI for opening a
// day yet, matching the same convention grower-picks.spec.ts and
// distributor-grower.spec.ts already use. This is also what sets up the
// "mixed family" scenario for real: a second variety in the same family
// is added to the grower's in-season list directly (no UI for that
// specific step either) but deliberately left at zero supply, so it's
// the live orderable-catalog computation — not a fixture shortcut — that
// decides it should stay hidden while its sibling variety and their
// shared family both show.
test.describe("Customer — order + history", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("browse (mixed family), add to cart, comment, submit, and see it in history", async ({ page }) => {
    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const growerUser = await createTestProfile({ companyId: grower.companyId, role: "grower" });
    cleanupFns.push(() => deleteTestUser(growerUser.userId));

    // A second variety in the SAME family as the grower's first product —
    // added to the grower's in-season list but never picked, so it stays
    // at zero supply. This is what makes the family "mixed": one variety
    // with real supply, one without.
    const depletedVariety = await createTestProductVariety({ familyId: grower.familyId });
    cleanupFns.push(() => deleteTestProductVariety(depletedVariety.id));
    await db.insert(growerProducts).values({ companyId: grower.companyId, productVarietyId: depletedVariety.id });

    const customerCompany = await createTestCompany("Test Customer", "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));
    const customerUser = await createTestProfile({ companyId: customerCompany.id, role: "customer" });
    cleanupFns.push(() => deleteTestUser(customerUser.userId));

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

    // The grower picks 10 pallets of their first variety; the second
    // (depletedVariety) is left untouched at its bootstrap default of 0.
    const growerClient = await signInTestUser(growerUser.email, growerUser.password);
    const pick = await getDailyPickForGrower(dayId, grower.companyId);
    const line = await getPickProductLine(pick!.id, grower.varietyId);
    const pickUpdate = await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs(
        updatePickProductPalletsInputSchema.parse({ dailyPickProductId: line!.id, palletsPicked: 10 }),
      ),
    );
    if (pickUpdate.error) throw pickUpdate.error;

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(customerUser.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(customerUser.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/customer\/order$/);

    // Mixed family: this grower's whole catalog is one family with two
    // varieties. The depleted one (zero supply, not in this customer's
    // cart) must not render at all — proven here by there being exactly
    // one product row on the whole page, not by asserting an absence of
    // specific text, since variety names are random per-test strings with
    // nothing else to distinguish them by. The family itself still
    // renders, via its one surviving variety.
    const productList = page.locator("main ul li");
    await expect(productList).toHaveCount(1);

    // Rows render collapsed (image + name + chevron); the pallets input and
    // comment control only exist once a row is expanded.
    const productToggle = page.locator("main").getByRole("button", { expanded: false });
    await productToggle.click();
    const palletsInput = page.locator('input[type="number"]');
    await expect(palletsInput).toHaveCount(1);

    await page.getByRole("button", { name: "ערוך" }).click();
    await palletsInput.fill("4");

    await page.getByRole("button", { name: /הערה/ }).click();
    await page.getByPlaceholder("הוסף הערה…").fill("gate code 4321");
    await page.getByRole("button", { name: "אישור" }).click();

    await page.getByRole("button", { name: "שמור" }).click();
    await expect(page.getByText("אישור הזמנה")).toBeVisible();
    await expect(page.getByText("4 פלטות")).toBeVisible();

    await page.getByRole("button", { name: "שלח הזמנה" }).click();
    await expect(page.getByText("ההזמנה נשלחה.")).toBeVisible();

    // Optimistic UI update: no reload needed to see the submitted state.
    await expect(palletsInput).toHaveValue("4");

    // A fresh reload confirms it actually persisted server-side, not just
    // in local draft state. The row collapses again on remount, so expand
    // it before reading the input back.
    await page.reload();
    await page.locator("main").getByRole("button", { expanded: false }).click();
    await expect(palletsInput).toHaveValue("4");

    await page.goto("/customer/history");
    const historyRow = page.getByRole("button", { name: "נשלח" });
    await expect(historyRow).toBeVisible();
    await historyRow.click();

    // Still today's open trading day (only submitted, not closed), so
    // history routes back to the same live, editable editor — pre-filled
    // with what was just submitted — rather than a read-only view.
    await expect(page).toHaveURL(/\/customer\/order\?orderId=/);
    await page.locator("main").getByRole("button", { expanded: false }).click();
    await expect(page.locator('input[type="number"]')).toHaveValue("4");
    await expect(page.getByText("הערה: gate code 4321")).toBeVisible();
  });
});
