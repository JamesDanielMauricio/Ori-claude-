import { db } from "@ori/db";
import { dailyOrderProducts, dailyOrders } from "@ori/db/schema";
import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "@ori/domain/auth/testing";
import {
  createTestGrowerWithProduct,
  createTestTradingDay,
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
} from "@ori/domain/lifecycle-engine/testing";
import { expect, test } from "@playwright/test";

import { chooseOption } from "./choose-option";

// Direct, measured verification of the source's own documented perf
// findings (st4ck spec "Performance Issues — Identified Bugs & Fixes"),
// not an assumption that a route-per-screen rebuild automatically fixes
// them. Each test's console.log output is the actual evidence this
// prompt's performance-verification report cites — see
// docs/ARCHITECTURE.md § Performance verification.
//
// A `window.__navMarker` set before an interaction and read back after is
// the decisive signal for "did a full page navigation happen" — a real
// `location.reload()`/full-document navigation wipes all in-memory JS
// state (this marker included), where a client-side SPA route change or a
// query invalidation does not. This is a stronger, more direct proof than
// asserting on visible UI state alone (see this file's own comment on why
// customer-order.spec.ts's existing "no reload" assertion doesn't
// actually rule out a reload that happens to re-render the same value).
test.describe("Performance verification — measured against the source's documented issues", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("Issue 2 — switching between backoffice screens renders in under 1 second with no full navigation", async ({
    page,
  }) => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.evaluate(() => {
      (window as unknown as { __navMarker: number }).__navMarker = Date.now();
    });
    const markerBefore = await page.evaluate(
      () => (window as unknown as { __navMarker: number }).__navMarker,
    );

    const start = Date.now();
    await page.getByRole("link", { name: "מוצרים", exact: true }).click();
    // The screen's only unconditional toolbar button. A variety is added from
    // inside an open family now, so there is no "מוצר חדש" button to wait on
    // — and no add control at all until a family is expanded, which is state
    // this timing assertion must not depend on. Creating a FAMILY has no
    // parent to sit inside, so its button is always there, and it appearing
    // proves the route rendered, which is all this waits for.
    await expect(page.getByRole("button", { name: "משפחה חדשה" }).first()).toBeVisible();
    const elapsedMs = Date.now() - start;

    const markerAfter = await page.evaluate(
      () => (window as unknown as { __navMarker: number }).__navMarker,
    );
    expect(markerAfter, "a full page navigation would have wiped this in-memory marker").toBe(
      markerBefore,
    );

    console.log(`[perf] backoffice route switch (shop -> products): ${elapsedMs}ms`);
    expect(elapsedMs).toBeLessThan(1000);
  });

  test("Issue 3/5 — re-selecting a previously-viewed order row in customer history fires no new query", async ({
    page,
  }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const customerCompany = await createTestCompany(
      `לקוח בדיקה ${crypto.randomUUID()}`,
      "customer",
    );
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));
    const customerUser = await createTestProfile({
      companyId: customerCompany.id,
      role: "customer",
    });
    cleanupFns.push(() => deleteTestUser(customerUser.userId));

    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    // Two historical (already-closed) trading days, each with one
    // submitted order for this customer — direct-inserted, since this
    // test only needs two distinct, already-populated history rows to
    // click between, not a real lifecycle walk.
    const dayA = await createTestTradingDay({
      initiatedByUserId: admin.userId,
      phase: "closed",
      tradeDate: "2026-07-01",
    });
    cleanupFns.push(() => deleteTestTradingDay(dayA.id));
    const dayB = await createTestTradingDay({
      initiatedByUserId: admin.userId,
      phase: "closed",
      tradeDate: "2026-07-02",
    });
    cleanupFns.push(() => deleteTestTradingDay(dayB.id));

    const [orderA] = await db
      .insert(dailyOrders)
      .values({ tradingDayId: dayA.id, customerCompanyId: customerCompany.id })
      .returning();
    const [orderB] = await db
      .insert(dailyOrders)
      .values({ tradingDayId: dayB.id, customerCompanyId: customerCompany.id })
      .returning();
    if (!orderA || !orderB) throw new Error("failed to create test orders");
    await db
      .insert(dailyOrderProducts)
      .values({ dailyOrderId: orderA.id, productVarietyId: grower.varietyId, palletsOrdered: "2" });
    await db
      .insert(dailyOrderProducts)
      .values({ dailyOrderId: orderB.id, productVarietyId: grower.varietyId, palletsOrdered: "3" });

    const lineRequestUrls: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/rest/v1/daily_order_products") && url.includes("daily_order_id=")) {
        lineRequestUrls.push(url);
      }
    });

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(customerUser.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(customerUser.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/customer\/order$/);
    await page.goto("/customer/history");

    // Rows show the short numeric date (e.g. "1.7.26"), not a spelled-out
    // Hebrew month — see history.tsx's shortDateLabel.
    const rowA = page.getByRole("button", { name: "1.7.26" });
    const rowB = page.getByRole("button", { name: "2.7.26" });
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();

    // Clicking a row now navigates to /customer/order?orderId=... (a
    // read-only view, since both days are closed) instead of opening an
    // in-page dialog — each click below is a full route change, mounting a
    // fresh ClosedOrderView. That's fine for what this test measures:
    // TanStack Query's cache lives on the QueryClient, not the component,
    // so a remount alone must not force a second network round trip for a
    // queryKey already cached within staleTime.
    await rowA.click();
    await expect(page).toHaveURL(new RegExp(`orderId=${orderA.id}`));
    await page.locator("main").getByRole("button", { expanded: false }).click();
    await expect(page.locator('input[type="number"]')).toHaveValue("2");
    const countAfterFirstA = lineRequestUrls.filter((url) => url.includes(orderA.id)).length;

    // Back via the shell's own nav link, NOT page.goto: a goto is a full
    // browser load, which tears down the QueryClient and takes its cache with
    // it. That would guarantee a second round trip below and make this test
    // assert the opposite of what it means to — the whole claim is that an
    // SPA route change reuses a cached queryKey.
    await page.getByRole("link", { name: "היסטוריית הזמנות" }).click();
    await expect(page).toHaveURL(/\/customer\/history$/);
    await rowB.click();
    await expect(page).toHaveURL(new RegExp(`orderId=${orderB.id}`));
    await page.locator("main").getByRole("button", { expanded: false }).click();
    await expect(page.locator('input[type="number"]')).toHaveValue("3");

    // Re-selecting A: within the QueryClient's 30s staleTime window
    // (apps/web/src/lib/providers.tsx), this must reuse the cached
    // result, not fire a third round trip.
    await page.getByRole("link", { name: "היסטוריית הזמנות" }).click();
    await expect(page).toHaveURL(/\/customer\/history$/);
    await rowA.click();
    await expect(page).toHaveURL(new RegExp(`orderId=${orderA.id}`));
    await page.locator("main").getByRole("button", { expanded: false }).click();
    await expect(page.locator('input[type="number"]')).toHaveValue("2");
    const countAfterRevisitA = lineRequestUrls.filter((url) => url.includes(orderA.id)).length;

    console.log(
      `[perf] daily_order_products requests for order A: ${countAfterFirstA} on first view, ${countAfterRevisitA} after revisiting`,
    );
    expect(countAfterFirstA).toBe(1);
    expect(countAfterRevisitA).toBe(1);
  });

  test("Issue 4 — submitting a customer order does not trigger a full page reload", async ({
    page,
  }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    // The customer company must exist BEFORE open_shop runs — its
    // bootstrap only creates a daily_orders row for customers that
    // already exist at that moment (matching customer-order.spec.ts's
    // own established ordering).
    const customerCompany = await createTestCompany(
      `לקוח בדיקה ${crypto.randomUUID()}`,
      "customer",
    );
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));
    const customerUser = await createTestProfile({
      companyId: customerCompany.id,
      role: "customer",
    });
    cleanupFns.push(() => deleteTestUser(customerUser.userId));

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await adminClient.rpc("initiate_business_day", { p_trade_date: tradeDate });
    if (initiate.error) throw initiate.error;
    const dayId = initiate.data!.id;
    cleanupFns.push(() => deleteTestTradingDay(dayId));
    const openShop = await adminClient.rpc("open_shop", { p_can_see_prices: true });
    if (openShop.error) throw openShop.error;

    // Give the grower's line real supply so the customer's order form has
    // something orderable to click.
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
    await page.getByLabel("אימייל").fill(customerUser.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(customerUser.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/customer\/order$/);

    await page.evaluate(() => {
      (window as unknown as { __navMarker: number }).__navMarker = Date.now();
    });
    const markerBefore = await page.evaluate(
      () => (window as unknown as { __navMarker: number }).__navMarker,
    );

    // Rows render collapsed; expand this fixture's own product row before it
    // has a quantity control to set. No "ערוך" click in between — the shop is
    // open, so the order is editable on arrival (routes/customer/order.tsx's
    // isOrderEditable) — and the control is the customer screen's capped
    // dropdown, not a typed number input.
    //
    // Addressed by family name rather than "the collapsed row in main":
    // initiate_business_day bootstraps a pick for every eligible grower, so
    // this catalog also lists every seeded demo family and that locator
    // matches dozens of rows.
    const familyName = grower.familyName;
    await page.getByRole("button", { name: familyName, exact: true }).click();
    const familyItem = page.locator("main li").filter({ hasText: familyName });
    await chooseOption(familyItem.getByRole("combobox"), "2");
    await page.getByRole("button", { name: "שמור" }).click();
    await expect(page.getByText("אישור הזמנה")).toBeVisible();

    const submitStart = Date.now();
    await page.getByRole("button", { name: "שלח הזמנה" }).click();
    await expect(page.getByText("ההזמנה נשלחה.")).toBeVisible();
    const submitElapsedMs = Date.now() - submitStart;

    const markerAfter = await page.evaluate(
      () => (window as unknown as { __navMarker: number }).__navMarker,
    );
    expect(
      markerAfter,
      "a full page reload (the source's ChangePage -> Current page) would have wiped this in-memory marker",
    ).toBe(markerBefore);

    console.log(`[perf] customer order submit, click-to-confirmation-toast: ${submitElapsedMs}ms`);
    expect(submitElapsedMs).toBeLessThan(3000);
  });
});
