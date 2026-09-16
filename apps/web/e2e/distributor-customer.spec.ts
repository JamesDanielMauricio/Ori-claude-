import { expect, test } from "@playwright/test";

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
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
} from "@ori/domain/lifecycle-engine/testing";

// Drives the distributor's Customer Order Status oversight screen end to
// end: a flat, always-visible list of every active customer (see
// distributor-customer.tsx's own comment for why this replaced a master-
// detail pane — same rationale as distributor-grower.spec.ts, mirrored onto
// orders), a chevron per row revealing that customer's order grouped by
// family, a pencil opening the exact same OrderLinesEditor the customer's
// own order screen uses in a dialog, and a bell resending the order
// reminder. Also carries the performance requirement Prompt 10 couldn't
// verify because this screen didn't exist yet (Performance Issues spec,
// Issue 3, tab=distributor+customer): reopening a customer's dialog after
// already viewing them this session must not fire a fresh catalog query —
// see the last test below, mirroring performance-verification.spec.ts's
// network-counting technique.
test.describe("Backoffice — Customer Order Status", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("a distributor expands a customer's row, edits their order via the pencil dialog, and sends a reminder", async ({
    page,
  }) => {
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
    const customerCompany = await createTestCompany(
      `לקוח בדיקה ${crypto.randomUUID()}`,
      "customer",
    );
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

    // Expanding shows the (still-empty) order grouped by family before any
    // editing happens — the read-only browse view, distinct from editing.
    // `exact`, not a regex: the row's pencil and bell are labelled "ערוך את
    // הזמנת <name>" and "שלח תזכורת ל<name>", so a substring match on the
    // company name resolves to all three controls. Only the row toggle is
    // named by the company alone.
    const expandButton = page.getByRole("button", { name: customerCompany.name, exact: true });
    await expandButton.click();
    // Scoped to this customer's own row: every seeded customer without an
    // order renders the same sentence, so on a populated day the unscoped
    // text matches a dozen of them.
    const customerRow = page.locator("li").filter({ hasText: customerCompany.name });
    await expect(customerRow.getByText("אין עדיין הזמנה עבור לקוח זה.")).toBeVisible();

    // The pencil, not the row itself, is what opens the editor now.
    const editButton = page.getByRole("button", { name: `ערוך את הזמנת ${customerCompany.name}` });
    await editButton.click();
    await expect(page.locator("dialog[open]")).toContainText(`הזמנה — ${customerCompany.name}`);

    // No "ערוך" gate inside the popup: the pencil already said "I want to
    // change this order", so the catalogue is live and "שמור" stays pinned
    // rather than sitting under the whole list, same as the arrangement
    // board's identical dialog.
    await expect(page.getByRole("button", { name: "ערוך", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "שמור" })).toBeVisible();
    // Rows render collapsed inside the dialog too; expand THIS fixture's
    // family before it has a pallets input to fill. The dialog hosts the same
    // full catalogue the customer's own screen does — every seeded family
    // included — so "the collapsed row in the dialog" matches dozens.
    const dialog = page.locator("dialog[open]");
    const dialogFamily = dialog.locator("li").filter({ hasText: grower.familyName });
    await dialogFamily.locator("button[aria-expanded]").first().click();
    await expect(dialogFamily.locator('input[type="number"]')).toBeEnabled();
    await dialogFamily.locator('input[type="number"]').fill("4");
    await page.getByRole("button", { name: "שמור" }).click();
    await expect(page.getByText("אישור הזמנה")).toBeVisible();
    await page.getByRole("button", { name: "שלח הזמנה" }).click();
    await expect(page.getByText("ההזמנה נשלחה.")).toBeVisible();
    // No explicit close here: a successful submit closes this dialog itself
    // (distributor-customer.tsx's onSubmitted clears the selected customer),
    // so waiting to click "סגור" waits for a button that is already gone.
    // The two closes later in this file are different — nothing was
    // submitted there, so the dialog stays up until it is dismissed.
    await expect(dialog).toHaveCount(0);

    // The order is now submitted — a reminder no longer makes sense, so
    // the bell is disabled instead of a second write path being exposed.
    const remindButton = page.getByRole("button", { name: `שלח תזכורת ל${customerCompany.name}` });
    await expect(remindButton).toBeDisabled();

    await page.reload();
    await page.getByRole("button", { name: `ערוך את הזמנת ${customerCompany.name}` }).click();
    // Read back off this fixture's own row, not "the number input in the
    // dialog": the dialog carries the whole catalogue, so that is one input
    // per variety in it.
    await expect(
      page.locator("dialog[open] li").filter({ hasText: grower.familyName }).locator('input[type="number"]'),
    ).toHaveValue("4");
  });

  test("sending a reminder on an un-submitted order dispatches to the outbox and stamps reminder_sent_at", async ({
    page,
  }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    const customerCompany = await createTestCompany(
      `לקוח בדיקה ${crypto.randomUUID()}`,
      "customer",
    );
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
    await page.getByRole("button", { name: `שלח תזכורת ל${customerCompany.name}` }).click();
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
    expect(outbox.data).toMatchObject([
      { template_key: "order_reminder", recipient_company_id: customerCompany.id },
    ]);
  });

  test("reopening a previously-viewed customer's dialog fires no new catalog query", async ({
    page,
  }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    const customerA = await createTestCompany(`לקוח בדיקה א ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerA.id));
    const customerB = await createTestCompany(`לקוח בדיקה ב ${crypto.randomUUID()}`, "customer");
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

    const editA = page.getByRole("button", { name: `ערוך את הזמנת ${customerA.name}` });
    const editB = page.getByRole("button", { name: `ערוך את הזמנת ${customerB.name}` });
    const dialog = page.locator("dialog[open]");

    await editA.click();
    // "שמור" is the editor's own landmark — it appears once the catalog
    // query for this customer has resolved, which is exactly the moment
    // this test is counting requests around.
    await expect(dialog.getByRole("button", { name: "שמור" })).toBeVisible();
    const countAfterA1 = catalogRequestUrls.length;
    // Closing unmounts OrderLinesEditor (see CustomerOrdersDialog's own
    // comment on why: `customerId !== null` gates whether it renders at
    // all) — the property under test is that React Query's cache, not the
    // component instance, is what makes reopening free.
    await dialog.getByRole("button", { name: "סגור" }).click();
    await expect(dialog).toHaveCount(0);

    await editB.click();
    await expect(dialog.getByRole("button", { name: "שמור" })).toBeVisible();
    const countAfterB = catalogRequestUrls.length;
    await dialog.getByRole("button", { name: "סגור" }).click();
    await expect(dialog).toHaveCount(0);

    // Reopening A: within the QueryClient's 30s staleTime window
    // (apps/web/src/lib/providers.tsx), OrderLinesEditor must reuse the
    // cached result for A's (tradingDayId, customerCompanyId) query key —
    // the same cache reuse performance-verification.spec.ts's Issue 3/5
    // test already proved for customer history, now against the screen
    // that issue actually named, and unaffected by the dialog remounting
    // the editor on every open/close (React Query's cache lives outside
    // the component's own mount lifecycle).
    await editA.click();
    await expect(dialog.getByRole("button", { name: "שמור" })).toBeVisible();
    const countAfterA2 = catalogRequestUrls.length;

    console.log(
      `[perf] get_orderable_catalog_for_customer requests: ${countAfterA1} after A, ${countAfterB} after A+B, ${countAfterA2} after reopening A`,
    );
    expect(countAfterA1).toBe(1);
    expect(countAfterB).toBe(2);
    expect(countAfterA2, "reopening A must reuse the cached result, firing no new request").toBe(
      countAfterB,
    );
  });
});
