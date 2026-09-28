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

import { chooseOption } from "./choose-option";

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

  // Longer than the 30s default: this walks the whole customer journey —
  // browse, comment, submit, reload, history, back into the order — and every
  // one of those steps re-renders a catalog that, since the seed grew to
  // ~600 varieties, is a genuinely large list. The extra budget is for the
  // rendering, not for hiding a hang; each individual assertion keeps its own
  // (much shorter) expect timeout.
  test("browse (mixed family), add to cart, comment, submit, and see it in history", async ({ page }) => {
    test.slow();
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

    const customerCompany = await createTestCompany("לקוח בדיקה", "customer");
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

    // Mixed family: this fixture's family holds two varieties, and the
    // depleted one (zero supply, not in this customer's cart) must not
    // render while its in-stock sibling — and therefore the family itself —
    // still does.
    //
    // Scoped to this test's own family rather than counting rows across the
    // whole page. initiate_business_day bootstraps a pick for EVERY eligible
    // grower, so the catalog this customer sees also contains every seeded
    // demo family; "exactly one row on the page" only ever held while the
    // database was empty.
    const familyName = grower.familyName;
    const familyItem = page.locator("main li").filter({ hasText: familyName });
    // The toggle is addressed structurally, not by accessible name: once this
    // family holds a quantity the row grows a filled-count chip, so its name
    // becomes "<family> 1" and any exact-name match stops working precisely
    // when the test starts needing it (after the order is submitted, below).
    const familyToggle = familyItem.locator("button[aria-expanded]").first();
    await expect(familyToggle).toBeVisible();

    // Rows render collapsed (image + name + chevron); the quantity dropdown
    // and comment control only exist once a row is expanded. The customer's
    // own order screen renders quantity as a dropdown capped to remaining
    // stock (order-product-list.tsx's quantityMode="dropdown"), not a typed
    // number input.
    await familyToggle.click();
    // One dropdown = one variety row under this family. That IS the
    // assertion the row count used to make: the depleted sibling is absent.
    const quantitySelect = familyItem.getByRole("combobox");
    await expect(quantitySelect).toHaveCount(1);

    // No "ערוך" gate: the shop is open, so the order is editable, full stop
    // (routes/customer/order.tsx's isOrderEditable). The dropdown is live
    // immediately and "שמור" is already on screen.
    await expect(page.getByRole("button", { name: "ערוך", exact: true })).toHaveCount(0);
    await expect(quantitySelect).toBeEnabled();
    await chooseOption(quantitySelect, "4");

    // Scoped to this family: every other family in the catalog renders its
    // own comment buttons too (the accordion panels stay mounted while
    // collapsed, by design — see order-product-list.tsx).
    await familyItem.getByRole("button", { name: /הערה/ }).click();
    await page.getByPlaceholder("הוסף הערה…").fill("gate code 4321");
    await page.getByRole("button", { name: "אישור" }).click();

    await page.getByRole("button", { name: "שמור" }).click();
    await expect(page.getByText("אישור הזמנה")).toBeVisible();
    await expect(page.getByText("4 פלטות")).toBeVisible();

    await page.getByRole("button", { name: "שלח הזמנה" }).click();
    await expect(page.getByText("ההזמנה נשלחה.")).toBeVisible();

    // Optimistic UI update: no reload needed to see the submitted state.
    await expect(quantitySelect).toHaveText("4");

    // A fresh reload confirms it actually persisted server-side, not just
    // in local draft state. The row collapses again on remount, so expand
    // it before reading the value back.
    await page.reload();
    await familyToggle.click();
    await expect(quantitySelect).toHaveText("4");

    await page.goto("/customer/history");
    const historyRow = page.getByRole("button", { name: "נשלח" });
    await expect(historyRow).toBeVisible();
    await historyRow.click();

    // Still today's open trading day (only submitted, not closed), so
    // history routes back to the same live, editable editor — pre-filled
    // with what was just submitted — rather than a read-only view.
    await expect(page).toHaveURL(/\/customer\/order\?orderId=/);
    await familyToggle.click();
    await expect(familyItem.getByRole("combobox")).toHaveText("4");
    // "הערה: <text>" is the READ-ONLY rendering. This view is the live
    // editable one (the comment two lines up says so — the day is still
    // open), where a comment shows as the "✎ הערה" button that opens it, so
    // the plain-text form is never in this DOM. Reading the value back out of
    // the popup checks the same thing the text did — that the comment
    // survived the round trip — without asserting the wrong view's markup.
    await familyItem.getByRole("button", { name: /הערה/ }).click();
    await expect(page.getByPlaceholder("הוסף הערה…")).toHaveValue("gate code 4321");
  });
});
