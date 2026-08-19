import { randomUUID } from "node:crypto";

import { db } from "@ori/db";
import { dailyPickProducts, dailyPicks, notificationOutbox, orderSubmissionLogs, productVarieties } from "@ori/db/schema";
import type { Database } from "@ori/db/supabase-types";
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
import { createTestProductVariety, deleteTestProductVariety } from "@ori/domain/reference-data/testing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  CUSTOMER_ERROR_CODES,
  toOrderableCatalogRpcArgs,
  toSendOrderReminderRpcArgs,
  toSubmitOrderRpcArgs,
} from "./schemas";
import {
  createTestDailyOrder,
  createTestDailyShop,
  getDailyOrderForCustomer,
  getOrderProductLine,
} from "./test-helpers";

// Every fixture trading day here is created directly at phase "shop_open",
// which — like every non-"closed" phase — participates in the
// single-open-trading-day partial unique index (0009). That's the same
// global constraint lifecycle.test.ts's own tests share, so this file
// needs the same discipline: sequential execution across test FILES
// (packages/domain/vitest.config.ts's fileParallelism: false) is what
// keeps this file's trading days from colliding with any other file's.
describe("customer ordering module", () => {
  const cleanupFns: Array<() => Promise<void>> = [];
  const adminCleanupFns: Array<() => Promise<void>> = [];
  let admin: { client: SupabaseClient<Database>; userId: string; companyId: string };

  // One shared backoffice admin for the whole file (beforeAll/afterAll),
  // not one per test the way every other module's test file does it.
  // None of these tests exercise anything admin-identity-specific — the
  // admin only ever opens a trading day and stamps a shop — so there's
  // nothing a fresh identity per test protects here. This file already
  // creates 2-3 customer identities per test (needed for genuine
  // multi-tenant assertions, e.g. the per-customer carve-out and the
  // concurrent-submission race), so cutting the other 3 of 4 admin
  // create+sign-in+delete cycles is a real reduction in the auth-service
  // load that correlates with the deleteUser flakiness documented in
  // docs/ARCHITECTURE.md's customer ordering module section — not just a
  // retry-harder mitigation (see auth/test-helpers.ts's deleteTestUser
  // pacing for that half of the fix).
  beforeAll(async () => {
    const company = await createTestCompany();
    adminCleanupFns.push(() => deleteTestCompany(company.id));
    const profile = await createTestProfile({ companyId: company.id, role: "backoffice" });
    adminCleanupFns.push(() => deleteTestUser(profile.userId));
    admin = {
      client: await signInTestUser(profile.email, profile.password),
      userId: profile.userId,
      companyId: company.id,
    };
  });

  afterAll(async () => {
    await runCleanup(adminCleanupFns);
  });

  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  async function signedInCustomer(customerCompanyId: string) {
    const customer = await createTestProfile({ companyId: customerCompanyId, role: "customer" });
    cleanupFns.push(() => deleteTestUser(customer.userId));
    return signInTestUser(customer.email, customer.password);
  }

  // Deliberately does NOT push its own cleanup: daily_orders/daily_picks
  // rows (and everything created against them below) have no
  // ON DELETE CASCADE back to the companies they reference, so the day
  // (and everything it cascades to) must be torn down BEFORE any
  // customer/grower company created alongside it — see
  // lifecycle-engine/test-helpers.ts's createTestTradingDay and the
  // grower module's identical note. Callers push this day's own cleanup
  // last, after every other fixture created alongside it, so it runs
  // first (runCleanup is LIFO).
  //
  // This matters even more here than in the grower module: a customer who
  // successfully calls submit_order gets an order_submission_logs row
  // (submitted_by references profiles.user_id, no cascade — it's meant to
  // survive independent of the submitting user's own lifecycle). That row
  // only goes away via daily_orders' cascade, i.e. when the day is
  // deleted. Deleting that customer's own auth user/profile BEFORE the
  // day is what used to surface as an opaque profiles FK violation during
  // cleanup — pushing the day's cleanup after every sign-in that might
  // have called submit_order (not just after company creation) is the
  // actual fix, not a timing workaround.
  async function createOpenTestDay(adminId: string) {
    const day = await createTestTradingDay({ initiatedByUserId: adminId, phase: "shop_open" });
    await createTestDailyShop({ tradingDayId: day.id, openedByUserId: adminId });
    return day;
  }

  async function createTestCustomer(tradingDayId: string) {
    const company = await createTestCompany(`Test Customer ${randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(company.id));
    await createTestDailyOrder({ tradingDayId, customerCompanyId: company.id });
    return { companyId: company.id };
  }

  async function pickLine(tradingDayId: string, growerCompanyId: string, productVarietyId: string, pallets: number) {
    const [pick] = await db.insert(dailyPicks).values({ tradingDayId, growerCompanyId }).returning();
    if (!pick) throw new Error("failed to create test daily pick");
    await db
      .insert(dailyPickProducts)
      .values({ dailyPickId: pick.id, productVarietyId, palletsPicked: pallets.toString() });
    return pick;
  }

  it("get_orderable_catalog_for_customer applies the family-survives-if-any-variety-orderable rule and the per-customer carve-out for a mixed family", async () => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const depletedVariety = await createTestProductVariety({
      familyId: grower.familyId,
      name: `Depleted ${randomUUID()}`,
    });
    cleanupFns.push(() => deleteTestProductVariety(depletedVariety.id));
    const day = await createOpenTestDay(admin.userId);

    // In-stock variety: 10 picked, nobody has ordered it yet.
    const pick = await pickLine(day.id, grower.companyId, grower.varietyId, 10);
    // Depleted variety: also picked (so it's genuinely "in today's shop",
    // not just absent), but zero supply.
    await db
      .insert(dailyPickProducts)
      .values({ dailyPickId: pick.id, productVarietyId: depletedVariety.id, palletsPicked: "0" });

    // Both customer fixtures — AND their sign-ins — are created up front,
    // before any assertion runs, so this day's cleanup (pushed right
    // after, last) is registered regardless of which assertion below
    // might fail, and runs before either customer's own user delete (see
    // createOpenTestDay's comment on why that matters — client2 below
    // calls submit_order).
    const customer1 = await createTestCustomer(day.id);
    const customer2 = await createTestCustomer(day.id);
    const client1 = await signedInCustomer(customer1.companyId);
    const client2 = await signedInCustomer(customer2.companyId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    // Customer 1: empty cart. Should see the in-stock variety and NOT the
    // depleted one — but the family itself must still appear (via the
    // in-stock variety), never dropped wholesale.
    const catalog1 = await client1.rpc(
      "get_orderable_catalog_for_customer",
      toOrderableCatalogRpcArgs({ tradingDayId: day.id }),
    );
    expect(catalog1.error).toBeNull();
    const family1Rows = catalog1.data!.filter((row) => row.family_id === grower.familyId);
    expect(family1Rows).toHaveLength(1);
    expect(family1Rows[0]).toMatchObject({ variety_id: grower.varietyId, is_orderable: true, pallets_ordered: 0 });

    // Customer 2: already has 3 pallets of the depleted variety in their
    // own order (placed before it went out of stock). The carve-out means
    // THEY still see it — is_orderable: false, but present — while the
    // in-stock variety is also present on its own merits. Neither
    // customer's view affects the other's.
    const submitCarveOut = await client2.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: depletedVariety.id, palletsOrdered: 3, comment: null }],
      }),
    );
    expect(submitCarveOut.error).toBeNull();

    const catalog2 = await client2.rpc(
      "get_orderable_catalog_for_customer",
      toOrderableCatalogRpcArgs({ tradingDayId: day.id }),
    );
    expect(catalog2.error).toBeNull();
    const family2Rows = catalog2.data!.filter((row) => row.family_id === grower.familyId);
    expect(family2Rows).toHaveLength(2);
    expect(family2Rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variety_id: grower.varietyId, is_orderable: true, pallets_ordered: 0 }),
        expect.objectContaining({ variety_id: depletedVariety.id, is_orderable: false, pallets_ordered: 3 }),
      ]),
    );

    // Customer 1's own view is unaffected by customer 2's carve-out — the
    // depleted variety still doesn't show for them.
    const catalog1Again = await client1.rpc(
      "get_orderable_catalog_for_customer",
      toOrderableCatalogRpcArgs({ tradingDayId: day.id }),
    );
    expect(catalog1Again.data!.some((row) => row.variety_id === depletedVariety.id)).toBe(false);
  }, 30000);

  it("submit_order is one transaction — upserts, prunes lines omitted from the new submission, stamps submission, and logs exactly one audit row per call", async () => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const secondVariety = await createTestProductVariety({ familyId: grower.familyId });
    cleanupFns.push(() => deleteTestProductVariety(secondVariety.id));
    const day = await createOpenTestDay(admin.userId);

    const pick = await pickLine(day.id, grower.companyId, grower.varietyId, 20);
    await db
      .insert(dailyPickProducts)
      .values({ dailyPickId: pick.id, productVarietyId: secondVariety.id, palletsPicked: "20" });

    const customer = await createTestCustomer(day.id);
    const client = await signedInCustomer(customer.companyId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const first = await client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [
          { productVarietyId: grower.varietyId, palletsOrdered: 4, comment: "first batch" },
          { productVarietyId: secondVariety.id, palletsOrdered: 2, comment: null },
        ],
      }),
    );
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ status: "submitted" });
    expect(first.data!.submitted_at).not.toBeNull();

    const orderAfterFirst = await getDailyOrderForCustomer(day.id, customer.companyId);
    const lineA = await getOrderProductLine(orderAfterFirst!.id, grower.varietyId);
    const lineB = await getOrderProductLine(orderAfterFirst!.id, secondVariety.id);
    expect(lineA).toMatchObject({ palletsOrdered: "4.00", comment: "first batch" });
    expect(lineB).toMatchObject({ palletsOrdered: "2.00" });

    // Second submission omits the second variety entirely (customer
    // zeroed it out in their draft) and changes the first — this must
    // prune the omitted line, not just leave it stale.
    const second = await client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 7, comment: "revised" }],
      }),
    );
    expect(second.error).toBeNull();

    const lineAAfter = await getOrderProductLine(orderAfterFirst!.id, grower.varietyId);
    const lineBAfter = await getOrderProductLine(orderAfterFirst!.id, secondVariety.id);
    expect(lineAAfter).toMatchObject({ palletsOrdered: "7.00", comment: "revised" });
    expect(lineBAfter).toBeNull();

    const logs = await db
      .select()
      .from(orderSubmissionLogs)
      .where(eq(orderSubmissionLogs.dailyOrderId, orderAfterFirst!.id));
    expect(logs).toHaveLength(2);
  }, 30000);

  it("submit_order rejects a closed trading day, a variety outside today's shop, a negative pallet count, and a non-customer caller", async () => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const outsideVariety = await createTestProductVariety({ familyId: grower.familyId });
    cleanupFns.push(() => deleteTestProductVariety(outsideVariety.id));
    const day = await createOpenTestDay(admin.userId);
    await pickLine(day.id, grower.companyId, grower.varietyId, 10);

    const customer = await createTestCustomer(day.id);
    const client = await signedInCustomer(customer.companyId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const negative = await client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: grower.varietyId, palletsOrdered: -1, comment: null }],
      }),
    );
    expect(negative.error).not.toBeNull();
    expect(negative.error?.code).toBe(CUSTOMER_ERROR_CODES.INVALID_INPUT);

    const outside = await client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: outsideVariety.id, palletsOrdered: 1, comment: null }],
      }),
    );
    expect(outside.error).not.toBeNull();
    expect(outside.error?.code).toBe(CUSTOMER_ERROR_CODES.INVALID_INPUT);

    const growerCompany = await createTestCompany(`Test Grower Caller ${randomUUID()}`, "grower");
    cleanupFns.push(() => deleteTestCompany(growerCompany.id));
    const growerUser = await createTestProfile({ companyId: growerCompany.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(growerUser.userId));
    const growerSession = await signInTestUser(growerUser.email, growerUser.password);
    const forbidden = await growerSession.rpc("submit_order", toSubmitOrderRpcArgs({ tradingDayId: day.id, lines: [] }));
    expect(forbidden.error).not.toBeNull();
    expect(forbidden.error?.code).toBe(CUSTOMER_ERROR_CODES.FORBIDDEN);

    await admin.client.from("trading_days").update({ phase: "closed" }).eq("id", day.id);
    const closed = await client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 1, comment: null }],
      }),
    );
    expect(closed.error).not.toBeNull();
    expect(closed.error?.code).toBe(CUSTOMER_ERROR_CODES.INVALID_STATE);
  }, 30000);

  it("concurrent submissions from two different customers against a depleting variety both succeed independently, and the resulting demand reflects both", async () => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const day = await createOpenTestDay(admin.userId);
    // Total supply: 5. Two customers will together order 7 — genuinely
    // exceeding what's available.
    await pickLine(day.id, grower.companyId, grower.varietyId, 5);

    const customerA = await createTestCustomer(day.id);
    const clientA = await signedInCustomer(customerA.companyId);
    const customerB = await createTestCustomer(day.id);
    const clientB = await signedInCustomer(customerB.companyId);
    const observer = await createTestCustomer(day.id);
    cleanupFns.push(() => deleteTestTradingDay(day.id));
    const clientObserver = await signedInCustomer(observer.companyId);

    const [resultA, resultB] = await Promise.all([
      clientA.rpc(
        "submit_order",
        toSubmitOrderRpcArgs({
          tradingDayId: day.id,
          lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 3, comment: null }],
        }),
      ),
      clientB.rpc(
        "submit_order",
        toSubmitOrderRpcArgs({
          tradingDayId: day.id,
          lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 4, comment: null }],
        }),
      ),
    ]);

    expect(resultA.error).toBeNull();
    expect(resultB.error).toBeNull();

    const orderA = await getDailyOrderForCustomer(day.id, customerA.companyId);
    const orderB = await getDailyOrderForCustomer(day.id, customerB.companyId);
    const lineA = await getOrderProductLine(orderA!.id, grower.varietyId);
    const lineB = await getOrderProductLine(orderB!.id, grower.varietyId);
    expect(lineA).toMatchObject({ palletsOrdered: "3.00" });
    expect(lineB).toMatchObject({ palletsOrdered: "4.00" });

    // A third party with no cart of their own sees the combined demand
    // (3 + 4 = 7 > 5 supply): no longer orderable. If either concurrent
    // write had been lost, this would incorrectly still read as in stock.
    const observerCatalog = await clientObserver.rpc(
      "get_orderable_catalog_for_customer",
      toOrderableCatalogRpcArgs({ tradingDayId: day.id }),
    );
    expect(observerCatalog.error).toBeNull();
    const varietyRow = observerCatalog.data!.find((row) => row.variety_id === grower.varietyId);
    expect(varietyRow).toBeUndefined();
  }, 30000);

  it("get_orderable_catalog_for_customer and submit_order let backoffice act on a customer's behalf, but reject the same parameter from a customer", async () => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const day = await createOpenTestDay(admin.userId);
    await pickLine(day.id, grower.companyId, grower.varietyId, 10);

    const customer = await createTestCustomer(day.id);
    const client = await signedInCustomer(customer.companyId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    // Backoffice reads the customer's own catalog+cart view by supplying
    // their company id explicitly — the same computation the customer's
    // own screen gets from omitting it.
    const backofficeCatalog = await admin.client.rpc(
      "get_orderable_catalog_for_customer",
      toOrderableCatalogRpcArgs({ tradingDayId: day.id, customerCompanyId: customer.companyId }),
    );
    expect(backofficeCatalog.error).toBeNull();
    const row = backofficeCatalog.data!.find((r) => r.variety_id === grower.varietyId);
    expect(row).toMatchObject({ is_orderable: true, pallets_ordered: 0 });

    // A customer supplying a company id at all — even their own — is
    // rejected outright; the parameter is backoffice-only, not merely
    // RLS-filtered.
    const spoofAttempt = await client.rpc(
      "get_orderable_catalog_for_customer",
      toOrderableCatalogRpcArgs({ tradingDayId: day.id, customerCompanyId: customer.companyId }),
    );
    expect(spoofAttempt.error).not.toBeNull();
    expect(spoofAttempt.error?.code).toBe(CUSTOMER_ERROR_CODES.FORBIDDEN);

    // Backoffice submits an order on the customer's behalf through the
    // exact same submit_order the customer's own screen calls.
    const backofficeSubmit = await admin.client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 5, comment: "placed by distributor" }],
        customerCompanyId: customer.companyId,
      }),
    );
    expect(backofficeSubmit.error).toBeNull();
    expect(backofficeSubmit.data).toMatchObject({ status: "submitted" });

    const order = await getDailyOrderForCustomer(day.id, customer.companyId);
    const line = await getOrderProductLine(order!.id, grower.varietyId);
    expect(line).toMatchObject({ palletsOrdered: "5.00", comment: "placed by distributor" });

    // The audit log attributes the write to whoever actually called it —
    // the backoffice user, not the customer whose order it is.
    const [log] = await db
      .select()
      .from(orderSubmissionLogs)
      .where(eq(orderSubmissionLogs.dailyOrderId, order!.id));
    expect(log).toMatchObject({ submittedBy: admin.userId });

    // A customer supplying a company id on submit_order — even their own
    // — is rejected the same way.
    const submitSpoof = await client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 1, comment: null }],
        customerCompanyId: customer.companyId,
      }),
    );
    expect(submitSpoof.error).not.toBeNull();
    expect(submitSpoof.error?.code).toBe(CUSTOMER_ERROR_CODES.FORBIDDEN);
  }, 30000);

  it("send_order_reminder stamps reminder_sent_at and dispatches one order_reminder outbox row, backoffice-only, and rejects an already-submitted order", async () => {
    const day = await createOpenTestDay(admin.userId);
    const customer = await createTestCustomer(day.id);
    const client = await signedInCustomer(customer.companyId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const order = await getDailyOrderForCustomer(day.id, customer.companyId);

    const forbidden = await client.rpc("send_order_reminder", toSendOrderReminderRpcArgs({ dailyOrderId: order!.id }));
    expect(forbidden.error).not.toBeNull();
    expect(forbidden.error?.code).toBe(CUSTOMER_ERROR_CODES.FORBIDDEN);

    const result = await admin.client.rpc(
      "send_order_reminder",
      toSendOrderReminderRpcArgs({ dailyOrderId: order!.id }),
    );
    expect(result.error).toBeNull();
    expect(result.data!.reminder_sent_at).not.toBeNull();

    const outboxRows = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, customer.companyId));
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({
      templateKey: "order_reminder",
      recipientType: "customer",
      tradingDayId: day.id,
    });

    // Once the order is submitted, a reminder no longer makes sense —
    // empty lines is enough to trip submit_order's own status transition
    // without needing a real in-shop variety.
    const submit = await client.rpc("submit_order", toSubmitOrderRpcArgs({ tradingDayId: day.id, lines: [] }));
    expect(submit.error).toBeNull();

    const afterSubmit = await admin.client.rpc(
      "send_order_reminder",
      toSendOrderReminderRpcArgs({ dailyOrderId: order!.id }),
    );
    expect(afterSubmit.error).not.toBeNull();
    expect(afterSubmit.error?.code).toBe(CUSTOMER_ERROR_CODES.INVALID_STATE);
  }, 30000);

  it("submit_order enqueues order_submitted to backoffice only on a direct customer submission, not the backoffice-on-behalf-of path — id 6", async () => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const day = await createOpenTestDay(admin.userId);
    await pickLine(day.id, grower.companyId, grower.varietyId, 10);

    const customer = await createTestCustomer(day.id);
    const client = await signedInCustomer(customer.companyId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    // Backoffice submitting on the customer's behalf must NOT self-notify.
    const backofficeSubmit = await admin.client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 2, comment: null }],
        customerCompanyId: customer.companyId,
      }),
    );
    expect(backofficeSubmit.error).toBeNull();
    const afterBackofficeSubmit = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, admin.companyId));
    expect(afterBackofficeSubmit).toHaveLength(0);

    // The customer submitting their own order does notify backoffice.
    const customerSubmit = await client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 3, comment: null }],
      }),
    );
    expect(customerSubmit.error).toBeNull();

    const afterCustomerSubmit = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, admin.companyId));
    expect(afterCustomerSubmit).toHaveLength(1);
    expect(afterCustomerSubmit[0]).toMatchObject({
      templateKey: "order_submitted",
      recipientType: "backoffice",
      tradingDayId: day.id,
    });
  }, 30000);

  it("submit_order enqueues stock_overbooking_reached exactly when demand crosses from under-supply to at-or-over-supply while overbooking room remains — id 10", async () => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const day = await createOpenTestDay(admin.userId);
    // Supply 10, overbooking 5 — orderable while demand < 15.
    await pickLine(day.id, grower.companyId, grower.varietyId, 10);
    await db.update(productVarieties).set({ noOverbooking: "5" }).where(eq(productVarieties.id, grower.varietyId));

    const customer = await createTestCustomer(day.id);
    const client = await signedInCustomer(customer.companyId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    // Demand 0 -> 4: stays well under supply, no crossing. (Every direct
    // customer submission also enqueues an unrelated order_submitted row,
    // id 6 — filtering by templateKey isolates this trigger from that
    // one, not just by recipientCompanyId.)
    const underSupply = await client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 4, comment: null }],
      }),
    );
    expect(underSupply.error).toBeNull();
    const afterUnderSupply = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, admin.companyId));
    expect(afterUnderSupply.filter((row) => row.templateKey === "stock_overbooking_reached")).toHaveLength(0);

    // Demand 4 -> 10: crosses base supply while overbooking room (5) remains.
    const crossing = await client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 10, comment: null }],
      }),
    );
    expect(crossing.error).toBeNull();

    const afterCrossing = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, admin.companyId));
    const overbookingRows = afterCrossing.filter((row) => row.templateKey === "stock_overbooking_reached");
    expect(overbookingRows).toHaveLength(1);
    expect(overbookingRows[0]).toMatchObject({ recipientType: "backoffice" });
    expect((overbookingRows[0]!.payload as { productOverbooking: string }).productOverbooking).toBe("5");
  }, 30000);

  it("submit_order enqueues stock_fully_exhausted exactly when demand consumes supply plus its overbooking room — id 11", async () => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const day = await createOpenTestDay(admin.userId);
    // Supply 10, overbooking 5 — orderable while demand < 15.
    await pickLine(day.id, grower.companyId, grower.varietyId, 10);
    await db.update(productVarieties).set({ noOverbooking: "5" }).where(eq(productVarieties.id, grower.varietyId));

    const customer = await createTestCustomer(day.id);
    const client = await signedInCustomer(customer.companyId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    // Demand 0 -> 12: past base supply (also crosses id 10, incidentally —
    // not this test's concern) but still under the overbooking ceiling.
    const stillOrderable = await client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 12, comment: null }],
      }),
    );
    expect(stillOrderable.error).toBeNull();
    const afterStillOrderable = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, admin.companyId));
    expect(afterStillOrderable.filter((row) => row.templateKey === "stock_fully_exhausted")).toHaveLength(0);

    // Demand 12 -> 16: consumes supply + overbooking entirely.
    const crossing = await client.rpc(
      "submit_order",
      toSubmitOrderRpcArgs({
        tradingDayId: day.id,
        lines: [{ productVarietyId: grower.varietyId, palletsOrdered: 16, comment: null }],
      }),
    );
    expect(crossing.error).toBeNull();

    const afterCrossing = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, admin.companyId));
    const exhaustedRows = afterCrossing.filter((row) => row.templateKey === "stock_fully_exhausted");
    expect(exhaustedRows).toHaveLength(1);
    expect(exhaustedRows[0]).toMatchObject({ recipientType: "backoffice" });
  }, 30000);
});
