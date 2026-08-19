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

  test("Issue 2 — switching between backoffice screens renders in under 1 second with no full navigation", async ({ page }) => {
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
    const markerBefore = await page.evaluate(() => (window as unknown as { __navMarker: number }).__navMarker);

    const start = Date.now();
    await page.getByRole("link", { name: "מוצרים", exact: true }).click();
    await expect(page.getByRole("button", { name: "מוצר חדש" })).toBeVisible();
    const elapsedMs = Date.now() - start;

    const markerAfter = await page.evaluate(() => (window as unknown as { __navMarker: number }).__navMarker);
    expect(markerAfter, "a full page navigation would have wiped this in-memory marker").toBe(markerBefore);

    console.log(`[perf] backoffice route switch (shop -> products): ${elapsedMs}ms`);
    expect(elapsedMs).toBeLessThan(1000);
  });

  test("Issue 3/5 — re-selecting a previously-viewed order row in customer history fires no new query", async ({ page }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const customerCompany = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));
    const customerUser = await createTestProfile({ companyId: customerCompany.id, role: "customer" });
    cleanupFns.push(() => deleteTestUser(customerUser.userId));

    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    // Two historical (already-closed) trading days, each with one
    // submitted order for this customer — direct-inserted, since this
    // test only needs two distinct, already-populated history rows to
    // click between, not a real lifecycle walk.
    const dayA = await createTestTradingDay({ initiatedByUserId: admin.userId, phase: "closed", tradeDate: "2026-07-01" });
    cleanupFns.push(() => deleteTestTradingDay(dayA.id));
    const dayB = await createTestTradingDay({ initiatedByUserId: admin.userId, phase: "closed", tradeDate: "2026-07-02" });
    cleanupFns.push(() => deleteTestTradingDay(dayB.id));

    const [orderA] = await db.insert(dailyOrders).values({ tradingDayId: dayA.id, customerCompanyId: customerCompany.id }).returning();
    const [orderB] = await db.insert(dailyOrders).values({ tradingDayId: dayB.id, customerCompanyId: customerCompany.id }).returning();
    if (!orderA || !orderB) throw new Error("failed to create test orders");
    await db.insert(dailyOrderProducts).values({ dailyOrderId: orderA.id, productVarietyId: grower.varietyId, palletsOrdered: "2" });
    await db.insert(dailyOrderProducts).values({ dailyOrderId: orderB.id, productVarietyId: grower.varietyId, palletsOrdered: "3" });

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

    const rowA = page.getByRole("button", { name: /1 ביולי/ });
    const rowB = page.getByRole("button", { name: /2 ביולי/ });
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();

    await rowA.click();
    await expect(page.getByRole("cell", { name: "2", exact: true })).toBeVisible();
    const countAfterFirstA = lineRequestUrls.filter((url) => url.includes(orderA.id)).length;

    await rowB.click();
    await expect(page.getByRole("cell", { name: "3", exact: true })).toBeVisible();

    // Re-selecting A: within the QueryClient's 30s staleTime window
    // (apps/web/src/lib/providers.tsx), this must reuse the cached
    // result, not fire a third round trip.
    await rowA.click();
    await expect(page.getByRole("cell", { name: "2", exact: true })).toBeVisible();
    const countAfterRevisitA = lineRequestUrls.filter((url) => url.includes(orderA.id)).length;

    console.log(
      `[perf] daily_order_products requests for order A: ${countAfterFirstA} on first view, ${countAfterRevisitA} after revisiting`,
    );
    expect(countAfterFirstA).toBe(1);
    expect(countAfterRevisitA).toBe(1);
  });

  test("Issue 4 — submitting a customer order does not trigger a full page reload", async ({ page }) => {
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
    const customerCompany = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));
    const customerUser = await createTestProfile({ companyId: customerCompany.id, role: "customer" });
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
    const pickRow = await adminClient.from("daily_picks").select("id").eq("trading_day_id", dayId).eq("grower_company_id", grower.companyId).single();
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
    const markerBefore = await page.evaluate(() => (window as unknown as { __navMarker: number }).__navMarker);

    await page.getByRole("button", { name: "ערוך" }).click();
    await page.locator('input[type="number"]').fill("2");
    await page.getByRole("button", { name: "שמור" }).click();
    await expect(page.getByText("אישור הזמנה")).toBeVisible();

    const submitStart = Date.now();
    await page.getByRole("button", { name: "שלח הזמנה" }).click();
    await expect(page.getByText("ההזמנה נשלחה.")).toBeVisible();
    const submitElapsedMs = Date.now() - submitStart;

    const markerAfter = await page.evaluate(() => (window as unknown as { __navMarker: number }).__navMarker);
    expect(markerAfter, "a full page reload (the source's ChangePage -> Current page) would have wiped this in-memory marker").toBe(
      markerBefore,
    );

    console.log(`[perf] customer order submit, click-to-confirmation-toast: ${submitElapsedMs}ms`);
    expect(submitElapsedMs).toBeLessThan(3000);
  });
});
