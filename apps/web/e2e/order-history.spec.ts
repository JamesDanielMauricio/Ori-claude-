import { toCreateArrangementRecordRpcArgs } from "@ori/domain/arrangement";
import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "@ori/domain/auth/testing";
import { toInitiateBusinessDayRpcArgs, toUpdatePickProductPalletsRpcArgs } from "@ori/domain/lifecycle-engine";
import {
  createTestGrowerWithProduct,
  createTestOrderProductLine,
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
  getDailyPickForGrower,
  getPickProductLine,
} from "@ori/domain/lifecycle-engine/testing";
import { expect, test } from "@playwright/test";

// Arrangement and Orders History by Date (PRD:
// backoffice/order-history-distributor-view.md): pick a date, see what
// was ordered vs. what was arranged for it. Read-only — this spec never
// clicks a save/write control, only confirms the numbers shown for a
// known historical date.
test.describe("Backoffice — Order History", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("a distributor picks a known date and sees ordered vs. arranged pallets for a customer's line", async ({ page }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const customerCompany = await createTestCompany(`לקוח בדיקה ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));

    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    const tradeDate = "2026-06-15";
    const initiate = await adminClient.rpc("initiate_business_day", toInitiateBusinessDayRpcArgs({ tradeDate }));
    if (initiate.error) throw initiate.error;
    const day = initiate.data!;
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const openShop = await adminClient.rpc("open_shop", { p_can_see_prices: true });
    if (openShop.error) throw openShop.error;

    const pick = await getDailyPickForGrower(day.id, grower.companyId);
    const pickLine = await getPickProductLine(pick!.id, grower.varietyId);
    const updatePallets = await adminClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: pickLine!.id, palletsPicked: 10 }),
    );
    if (updatePallets.error) throw updatePallets.error;

    // Ordered 6, but only 4 actually arranged — the deliberate mismatch
    // this screen exists to surface for dispute resolution.
    const orderLine = await createTestOrderProductLine(day.id, customerCompany.id, grower.varietyId, 6);
    const createRecord = await adminClient.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({ dailyPickProductId: pickLine!.id, dailyOrderProductId: orderLine.id, quantityPallets: 4 }),
    );
    if (createRecord.error) throw createRecord.error;

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.goto("/backoffice/order-history");
    // `exact` matters: the backoffice rail's trading-day picker is labelled
    // "יום מסחר מוצג — בחר תאריך", so a substring match resolves to two
    // elements and Playwright's strict mode rejects it. This page's own
    // field is labelled exactly "תאריך".
    await page.getByLabel("תאריך", { exact: true }).fill(tradeDate);

    const customerRow = page.getByRole("button", { name: new RegExp(customerCompany.name) });
    await expect(customerRow).toBeVisible();
    await customerRow.click();

    // "Ordered" (6) and "Arranged" (4) both visible in the drill-in table,
    // proving the mismatch survives to the UI rather than being masked.
    await expect(page.getByRole("cell", { name: "6", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "4", exact: true })).toBeVisible();
  });

  test("picking a date with no trading day shows an empty state, not an error", async ({ page }) => {
    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.goto("/backoffice/order-history");
    await page.getByLabel("תאריך", { exact: true }).fill("2019-01-01");
    // No trailing period: this copy is an EmptyState `title`, and titles
    // across the app are written without terminal punctuation. The string
    // here kept a period from back when the same message was a sentence,
    // which `getByText`'s substring match can never find inside the
    // period-less heading actually rendered.
    await expect(page.getByText("אין יום מסחר בתאריך זה")).toBeVisible();
  });
});
