import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "@ori/domain/auth/testing";
import { createTestGrowerWithProduct, deleteTestGrowerWithProduct, deleteTestTradingDay } from "@ori/domain/lifecycle-engine/testing";
import { expect, test } from "@playwright/test";

// Drives the distributor's Customer Order Status oversight screen end to
// end: the same OrderLinesEditor the customer's own order screen uses, now
// under a backoffice session editing/submitting on the customer's behalf,
// plus send_order_reminder. Also carries the performance requirement
// Prompt 10 couldn't verify because this screen didn't exist yet
// (Performance Issues spec, Issue 3, tab=distributor+customer): expanding
// a customer already viewed in this session must not fire a fresh query —
// see the last test below, mirroring performance-verification.spec.ts's
// network-counting technique.
test.describe("Backoffice — Customer Order Status", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("a distributor edits a customer's order on their behalf and sends a reminder", async ({ page }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    // The customer company must exist before open_shop runs — its
    // bootstrap only creates a daily_orders row for customers that
    // already exist at that moment (same ordering requirement
    // performance-verification.spec.ts's Issue 4 test already established).
    const customerCompany = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await adminClient.rpc("initiate_business_day", { p_trade_date: tradeDate });
    if (initiate.error) throw initiate.error;
    const dayId = initiate.data!.id;
    cleanupFns.push(() => deleteTestTradingDay(dayId));
    const openShop = await adminClient.rpc("open_shop", { p_can_see_prices: true });
    if (openShop.error) throw openShop.error;

    const pickRow = await adminClient
      .from("daily_picks")
      .select("id")
      .eq("trading_day_id", dayId)
      .eq("grower_company_id", grower.companyId)
      .single();
    await adminClient
      .from("daily_pick_products")
      .update({ pallets_picked: "10" })
      .eq("daily_pick_id", pickRow.data!.id)
      .eq("product_variety_id", grower.varietyId);

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.goto("/backoffice/distributor-customer");
    const customerRow = page.getByRole("button", { name: new RegExp(customerCompany.name) });
    await expect(customerRow).toBeVisible();
    await customerRow.click();

    await expect(page.getByRole("button", { name: "ערוך", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "ערוך", exact: true }).click();
    await page.locator('input[type="number"]').fill("4");
    await page.getByRole("button", { name: "שמור" }).click();
    await expect(page.getByText("אישור הזמנה")).toBeVisible();
    await page.getByRole("button", { name: "שלח הזמנה" }).click();
    await expect(page.getByText("ההזמנה נשלחה.")).toBeVisible();

    // The order is now submitted — a reminder no longer makes sense, so
    // the button is disabled instead of a second write path being exposed.
    await expect(page.getByRole("button", { name: "שלח תזכורת" })).toBeDisabled();

    await page.reload();
    await customerRow.click();
    await expect(page.locator('input[type="number"]')).toHaveValue("4");
  });

  test("sending a reminder on an un-submitted order dispatches to the outbox and stamps reminder_sent_at", async ({ page }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    const customerCompany = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await adminClient.rpc("initiate_business_day", { p_trade_date: tradeDate });
    if (initiate.error) throw initiate.error;
    const dayId = initiate.data!.id;
    cleanupFns.push(() => deleteTestTradingDay(dayId));
    const openShop = await adminClient.rpc("open_shop", { p_can_see_prices: true });
    if (openShop.error) throw openShop.error;

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.goto("/backoffice/distributor-customer");
    await page.getByRole("button", { name: new RegExp(customerCompany.name) }).click();
    await page.getByRole("button", { name: "שלח תזכורת" }).click();
    await expect(page.getByText("התזכורת נשלחה.")).toBeVisible();

    const order = await adminClient
      .from("daily_orders")
      .select("reminder_sent_at")
      .eq("trading_day_id", dayId)
      .eq("customer_company_id", customerCompany.id)
      .single();
    expect(order.data!.reminder_sent_at).not.toBeNull();

    // Scoped to reminder-specific rows — open_shop's own bootstrap
    // (id 4, a later prompt) already, separately enqueues a shop_open
    // row to this same customer, which isn't what this test is about.
    const outbox = await adminClient
      .from("notification_outbox")
      .select("template_key, recipient_company_id")
      .eq("recipient_company_id", customerCompany.id)
      .eq("template_key", "order_reminder");
    expect(outbox.data).toMatchObject([{ template_key: "order_reminder", recipient_company_id: customerCompany.id }]);
  });

  test("re-selecting a previously-viewed customer fires no new catalog query", async ({ page }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    const customerA = await createTestCompany(`Test Customer A ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerA.id));
    const customerB = await createTestCompany(`Test Customer B ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerB.id));

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await adminClient.rpc("initiate_business_day", { p_trade_date: tradeDate });
    if (initiate.error) throw initiate.error;
    const dayId = initiate.data!.id;
    cleanupFns.push(() => deleteTestTradingDay(dayId));
    const openShop = await adminClient.rpc("open_shop", { p_can_see_prices: true });
    if (openShop.error) throw openShop.error;

    const pickRow = await adminClient
      .from("daily_picks")
      .select("id")
      .eq("trading_day_id", dayId)
      .eq("grower_company_id", grower.companyId)
      .single();
    await adminClient
      .from("daily_pick_products")
      .update({ pallets_picked: "10" })
      .eq("daily_pick_id", pickRow.data!.id)
      .eq("product_variety_id", grower.varietyId);

    const catalogRequestUrls: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/rest/v1/rpc/get_orderable_catalog_for_customer")) {
        catalogRequestUrls.push(url);
      }
    });

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.goto("/backoffice/distributor-customer");

    const rowA = page.getByRole("button", { name: new RegExp(customerA.name) });
    const rowB = page.getByRole("button", { name: new RegExp(customerB.name) });

    await rowA.click();
    await expect(page.getByRole("button", { name: "ערוך", exact: true })).toBeVisible();
    const countAfterA1 = catalogRequestUrls.length;

    await rowB.click();
    await expect(page.getByRole("button", { name: "ערוך", exact: true })).toBeVisible();
    const countAfterB = catalogRequestUrls.length;

    // Re-selecting A: within the QueryClient's 30s staleTime window
    // (apps/web/src/lib/providers.tsx), OrderLinesEditor must reuse the
    // cached result for A's (tradingDayId, customerCompanyId) query key —
    // the same cache reuse performance-verification.spec.ts's Issue 3/5
    // test already proved for customer history, now against the screen
    // that issue actually named.
    await rowA.click();
    await expect(page.getByRole("button", { name: "ערוך", exact: true })).toBeVisible();
    const countAfterA2 = catalogRequestUrls.length;

    console.log(
      `[perf] get_orderable_catalog_for_customer requests: ${countAfterA1} after A, ${countAfterB} after A+B, ${countAfterA2} after revisiting A`,
    );
    expect(countAfterA1).toBe(1);
    expect(countAfterB).toBe(2);
    expect(countAfterA2, "revisiting A must reuse the cached result, firing no new request").toBe(countAfterB);
  });
});
