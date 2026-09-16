import { db } from "@ori/db";
import { companies, dailyOrders, notificationOutbox, productVarieties } from "@ori/db/schema";
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
  LIFECYCLE_ERROR_CODES,
  toInitiateBusinessDayRpcArgs,
  toUpdatePickProductPalletsRpcArgs,
} from "@ori/domain/lifecycle-engine";
import {
  createTestGrowerWithProduct,
  createTestOrderProductLine,
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
  getDailyPickForGrower,
  getPickProductLine,
} from "@ori/domain/lifecycle-engine/testing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  ARRANGEMENT_ERROR_CODES,
  toCreateArrangementRecordRpcArgs,
  toDeleteArrangementRecordRpcArgs,
  toUpdateArrangementRecordRpcArgs,
} from "./schemas";

// Like customer.test.ts, every fixture trading day here is created via the
// real initiate_business_day RPC (single-open-trading-day partial unique
// index, 0009) — sequential execution across the whole domain package
// (vitest.config.ts's fileParallelism: false) is what keeps this file's
// days from colliding with lifecycle.test.ts's or customer.test.ts's.
describe("arrangement module", () => {
  const cleanupFns: Array<() => Promise<void>> = [];
  const adminCleanupFns: Array<() => Promise<void>> = [];
  let admin: { client: SupabaseClient<Database>; userId: string };

  // One shared backoffice admin for the whole file — every function this
  // module tests is backoffice-only, so there's nothing an identity-per-test
  // would protect here (same reasoning as customer.test.ts).
  beforeAll(async () => {
    const company = await createTestCompany();
    adminCleanupFns.push(() => deleteTestCompany(company.id));
    const profile = await createTestProfile({ companyId: company.id, role: "backoffice" });
    adminCleanupFns.push(() => deleteTestUser(profile.userId));
    admin = {
      client: await signInTestUser(profile.email, profile.password),
      userId: profile.userId,
    };
  });

  afterAll(async () => {
    await runCleanup(adminCleanupFns);
  });

  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  // Sets up a trading day (via the real RPC, so the bootstrap pick/
  // arrangement rows exist) with one grower pick line and one customer
  // order line for the same variety, and returns everything a test needs
  // to pair them via create_arrangement_record.
  async function setUpDayWithSupplyAndDemand(palletsPicked: number, palletsOrdered: number) {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const customer = await createTestCompany(`לקוח בדיקה ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customer.id));

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await admin.client.rpc(
      "initiate_business_day",
      toInitiateBusinessDayRpcArgs({ tradeDate }),
    );
    expect(initiate.error).toBeNull();
    const day = initiate.data!;
    // Pushed before the grower/customer companies (LIFO: this runs first),
    // matching lifecycle-engine/test-helpers.ts's cascade-ordering note —
    // deleting the day cascades away the pick/order lines and arrangement
    // records this test creates, before their owning companies are torn
    // down.
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    // Opened before the order line is created below: open_shop bootstraps
    // a daily_orders header for every active customer, with no
    // ON CONFLICT DO NOTHING — creating the order line first would leave
    // open_shop to collide with it on daily_orders' own
    // (trading_day_id, customer_company_id) unique constraint.
    const openShop = await admin.client.rpc("open_shop", { p_can_see_prices: true });
    expect(openShop.error).toBeNull();

    const pick = await getDailyPickForGrower(day.id, grower.companyId);
    const pickLine = await getPickProductLine(pick!.id, grower.varietyId);
    const updatePallets = await admin.client.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: pickLine!.id, palletsPicked }),
    );
    expect(updatePallets.error).toBeNull();

    const orderLine = await createTestOrderProductLine(
      day.id,
      customer.id,
      grower.varietyId,
      palletsOrdered,
    );

    return { day, grower, customer, pickProductId: pickLine!.id, orderProductId: orderLine.id };
  }

  it("create_arrangement_record blocks over-allocation against the pick line's own pallets_picked ceiling", async () => {
    const { pickProductId, orderProductId } = await setUpDayWithSupplyAndDemand(5, 10);

    const overSupply = await admin.client.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({
        dailyPickProductId: pickProductId,
        dailyOrderProductId: orderProductId,
        quantityPallets: 6,
      }),
    );
    expect(overSupply.error).not.toBeNull();
    expect(overSupply.error?.code).toBe(ARRANGEMENT_ERROR_CODES.OVER_ALLOCATION);

    const atCeiling = await admin.client.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({
        dailyPickProductId: pickProductId,
        dailyOrderProductId: orderProductId,
        quantityPallets: 5,
      }),
    );
    expect(atCeiling.error).toBeNull();
    expect(atCeiling.data).toMatchObject({
      daily_pick_product_id: pickProductId,
      daily_order_product_id: orderProductId,
    });
  }, 30000);

  it("create_arrangement_record blocks over-allocation against the order line's own pallets_ordered ceiling", async () => {
    const { pickProductId, orderProductId } = await setUpDayWithSupplyAndDemand(10, 4);

    const overDemand = await admin.client.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({
        dailyPickProductId: pickProductId,
        dailyOrderProductId: orderProductId,
        quantityPallets: 6,
      }),
    );
    expect(overDemand.error).not.toBeNull();
    expect(overDemand.error?.code).toBe(ARRANGEMENT_ERROR_CODES.OVER_ALLOCATION);

    const atCeiling = await admin.client.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({
        dailyPickProductId: pickProductId,
        dailyOrderProductId: orderProductId,
        quantityPallets: 4,
      }),
    );
    expect(atCeiling.error).toBeNull();
  }, 30000);

  it("create_arrangement_record rejects a genuinely concurrent double-call that would jointly over-allocate the same pick line — two real rpc() calls racing via Promise.all", async () => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const customerA = await createTestCompany(`לקוח בדיקה ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerA.id));
    const customerB = await createTestCompany(`לקוח בדיקה ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerB.id));

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await admin.client.rpc(
      "initiate_business_day",
      toInitiateBusinessDayRpcArgs({ tradeDate }),
    );
    expect(initiate.error).toBeNull();
    const day = initiate.data!;
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const openShop = await admin.client.rpc("open_shop", { p_can_see_prices: true });
    expect(openShop.error).toBeNull();

    // 10 pallets picked — each of the two racing calls (6 pallets) is
    // within that ceiling alone, but the two together (12) are not.
    const pick = await getDailyPickForGrower(day.id, grower.companyId);
    const pickLine = await getPickProductLine(pick!.id, grower.varietyId);
    const updatePallets = await admin.client.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: pickLine!.id, palletsPicked: 10 }),
    );
    expect(updatePallets.error).toBeNull();

    // Two different order lines (10 pallets ordered each) so demand is
    // never the limiting side of this race — only the shared pick line's
    // supply ceiling is being contended for.
    const orderLineA = await createTestOrderProductLine(day.id, customerA.id, grower.varietyId, 10);
    const orderLineB = await createTestOrderProductLine(day.id, customerB.id, grower.varietyId, 10);

    const [first, second] = await Promise.all([
      admin.client.rpc(
        "create_arrangement_record",
        toCreateArrangementRecordRpcArgs({
          dailyPickProductId: pickLine!.id,
          dailyOrderProductId: orderLineA.id,
          quantityPallets: 6,
        }),
      ),
      admin.client.rpc(
        "create_arrangement_record",
        toCreateArrangementRecordRpcArgs({
          dailyPickProductId: pickLine!.id,
          dailyOrderProductId: orderLineB.id,
          quantityPallets: 6,
        }),
      ),
    ]);

    // create_arrangement_record locks the trading day's daily_arrangements
    // row (`select ... for update`) before it ever sums existing
    // arrangement_records — the same serialization mechanism
    // close_arrangement's own concurrency test relies on. The loser's
    // check_arrangement_allocation call only runs after the winner's
    // insert has committed, so it sees the winner's 6 pallets already
    // counted against the pick line's 10-pallet ceiling and correctly
    // rejects its own 6 (6 + 6 > 10) — this is real serialization
    // catching a real race, not a lucky ordering of two independent calls.
    const results = [first, second];
    const succeeded = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error?.code).toBe(ARRANGEMENT_ERROR_CODES.OVER_ALLOCATION);

    const { data: recordsAfter } = await admin.client
      .from("arrangement_records")
      .select("quantity_pallets")
      .eq("daily_pick_product_id", pickLine!.id);
    expect(recordsAfter).toHaveLength(1);
  }, 30000);

  it("update_arrangement_record excludes its own prior quantity from the ceiling; delete_arrangement_record frees it back up", async () => {
    const { pickProductId, orderProductId } = await setUpDayWithSupplyAndDemand(5, 5);

    const created = await admin.client.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({
        dailyPickProductId: pickProductId,
        dailyOrderProductId: orderProductId,
        quantityPallets: 5,
      }),
    );
    expect(created.error).toBeNull();
    const recordId = created.data!.id;

    // Re-affirming the SAME quantity (5) would self-block if the ceiling
    // check didn't exclude this record's own prior contribution — proves
    // p_excluding_record_id is actually wired through.
    const sameQuantity = await admin.client.rpc(
      "update_arrangement_record",
      toUpdateArrangementRecordRpcArgs({ id: recordId, quantityPallets: 5 }),
    );
    expect(sameQuantity.error).toBeNull();

    // Raising it further, with nothing else to arrange against, must still
    // be blocked — excluding this record's own quantity doesn't mean no
    // ceiling at all.
    const overCeiling = await admin.client.rpc(
      "update_arrangement_record",
      toUpdateArrangementRecordRpcArgs({ id: recordId, quantityPallets: 6 }),
    );
    expect(overCeiling.error).not.toBeNull();
    expect(overCeiling.error?.code).toBe(ARRANGEMENT_ERROR_CODES.OVER_ALLOCATION);

    const deleted = await admin.client.rpc(
      "delete_arrangement_record",
      toDeleteArrangementRecordRpcArgs({ id: recordId }),
    );
    expect(deleted.error).toBeNull();

    // With the record gone, the full ceiling is available again to a new
    // record.
    const recreated = await admin.client.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({
        dailyPickProductId: pickProductId,
        dailyOrderProductId: orderProductId,
        quantityPallets: 5,
      }),
    );
    expect(recreated.error).toBeNull();
  }, 30000);

  it("close_arrangement is all-or-nothing: an arrangement record whose variety has no price or price range configured rolls back the entire transaction", async () => {
    const { day, pickProductId, orderProductId } = await setUpDayWithSupplyAndDemand(5, 5);

    // createTestGrowerWithProduct's variety has neither `price` nor a
    // price_range_from/to pair set — a genuine, pre-existing data gap, not
    // a contrived failure injection (see docs/SCHEMA_DECISIONS.md).
    const created = await admin.client.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({
        dailyPickProductId: pickProductId,
        dailyOrderProductId: orderProductId,
        quantityPallets: 5,
      }),
    );
    expect(created.error).toBeNull();

    const closeShop = await admin.client.rpc("close_shop");
    expect(closeShop.error).toBeNull();

    const closeArrangement = await admin.client.rpc("close_arrangement");
    expect(closeArrangement.error).not.toBeNull();
    expect(closeArrangement.error?.code).toBe(LIFECYCLE_ERROR_CODES.INVALID_STATE);

    // Prove the whole function body rolled back, not just the pricing
    // step: the day is still shop_closed (not closed), the arrangement is
    // still open, and the picks close_arrangement mass-closes earlier in
    // its own body are still NOT closed — every statement before the
    // pricing failure is undone along with it.
    const { data: dayAfter } = await admin.client
      .from("trading_days")
      .select("phase")
      .eq("id", day.id)
      .single();
    expect(dayAfter?.phase).toBe("shop_closed");

    const { data: arrangementAfter } = await admin.client
      .from("daily_arrangements")
      .select("status")
      .eq("trading_day_id", day.id)
      .single();
    expect(arrangementAfter?.status).toBe("open");

    const { data: picksAfter } = await admin.client
      .from("daily_picks")
      .select("status")
      .eq("trading_day_id", day.id);
    expect(picksAfter?.every((row) => row.status !== "closed")).toBe(true);

    // Everything close_arrangement's body runs AFTER the pricing step —
    // the notification_outbox writes and the lifecycle_sessions insert
    // itself — never happened either. Unlike the source (where the
    // Session is Action 1, created BEFORE any side effects — see
    // reference/prd/lifecycle-invariants.md's Invariant 5 — so a
    // partial-failure Session can legitimately exist there), this
    // rebuild's Session insert is the function's LAST statement, so its
    // absence here is a direct, load-bearing proof of the rollback, not
    // just a side observation. Filtered to close_arrangement's own
    // session_type ('end_the_day') — the earlier, successful close_shop
    // call above legitimately left its own 'close_shop' session behind.
    const { count: sessionCount } = await admin.client
      .from("lifecycle_sessions")
      .select("id", { count: "exact", head: true })
      .eq("trading_day_id", day.id)
      .eq("session_type", "end_the_day");
    expect(sessionCount).toBe(0);

    // Scoped to close_arrangement's own template_keys, not "zero rows for
    // this day" outright — setUpDayWithSupplyAndDemand's own open_shop
    // call already legitimately (and separately) committed a shop_open
    // row per active customer (id 4) before this test ever calls
    // close_arrangement; that row isn't part of what's being rolled back
    // here, the same reasoning as session_count's session_type filter
    // just above.
    const { data: outboxRows } = await admin.client
      .from("notification_outbox")
      .select("template_key")
      .eq("trading_day_id", day.id);
    const closeArrangementRows = outboxRows?.filter((row) =>
      ["close_arrangement_customer", "close_arrangement_grower"].includes(row.template_key),
    );
    expect(closeArrangementRows).toHaveLength(0);
  }, 30000);

  it("close_arrangement populates a priced arrangement record's price from the variety's fixed price, and writes a notification_outbox row for the customer", async () => {
    const { day, grower, customer, pickProductId, orderProductId } =
      await setUpDayWithSupplyAndDemand(5, 5);

    await db
      .update(productVarieties)
      .set({ price: "12.50" })
      .where(eq(productVarieties.id, grower.varietyId));

    const created = await admin.client.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({
        dailyPickProductId: pickProductId,
        dailyOrderProductId: orderProductId,
        quantityPallets: 5,
      }),
    );
    expect(created.error).toBeNull();
    const recordId = created.data!.id;

    // The customer's order must actually be submitted (status <> 'open')
    // for build_notification_outbox to include them — matches the
    // source's own eligibility criterion (see 0022's header comment).
    await db
      .update(dailyOrders)
      .set({ status: "submitted" })
      .where(
        and(eq(dailyOrders.tradingDayId, day.id), eq(dailyOrders.customerCompanyId, customer.id)),
      );

    const closeShop = await admin.client.rpc("close_shop");
    expect(closeShop.error).toBeNull();

    const closeArrangement = await admin.client.rpc("close_arrangement");
    expect(closeArrangement.error).toBeNull();

    const { data: recordAfter } = await admin.client
      .from("arrangement_records")
      .select("price")
      .eq("id", recordId)
      .single();
    // PostgREST returns `numeric` columns as bare JSON numbers, not
    // decimal-preserving strings — see apps/web's customer/history page
    // for the same empirically-verified behavior.
    expect(recordAfter?.price).toBe(12.5);

    const { data: outboxRows } = await admin.client
      .from("notification_outbox")
      .select("recipient_type, recipient_company_id")
      .eq("trading_day_id", day.id);
    expect(outboxRows).toContainEqual({
      recipient_type: "customer",
      recipient_company_id: customer.id,
    });
    expect(outboxRows).toContainEqual({
      recipient_type: "grower",
      recipient_company_id: grower.companyId,
    });
  }, 30000);

  it("close_arrangement does not cc a transporter when the grower has none assigned", async () => {
    const { day, grower, customer, pickProductId, orderProductId } =
      await setUpDayWithSupplyAndDemand(5, 5);
    await db
      .update(productVarieties)
      .set({ price: "12.50" })
      .where(eq(productVarieties.id, grower.varietyId));

    const created = await admin.client.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({
        dailyPickProductId: pickProductId,
        dailyOrderProductId: orderProductId,
        quantityPallets: 5,
      }),
    );
    expect(created.error).toBeNull();

    await db
      .update(dailyOrders)
      .set({ status: "submitted" })
      .where(
        and(eq(dailyOrders.tradingDayId, day.id), eq(dailyOrders.customerCompanyId, customer.id)),
      );

    const closeShop = await admin.client.rpc("close_shop");
    expect(closeShop.error).toBeNull();
    const closeArrangement = await admin.client.rpc("close_arrangement");
    expect(closeArrangement.error).toBeNull();

    const { data: outboxRows } = await admin.client
      .from("notification_outbox")
      .select("recipient_type")
      .eq("trading_day_id", day.id);
    expect(outboxRows?.filter((row) => row.recipient_type === "transporter")).toHaveLength(0);
  }, 30000);

  it("close_arrangement ccs the grower's assigned transporter with the same close_arrangement_grower message — id 8", async () => {
    const { day, grower, customer, pickProductId, orderProductId } =
      await setUpDayWithSupplyAndDemand(5, 5);
    await db
      .update(productVarieties)
      .set({ price: "12.50" })
      .where(eq(productVarieties.id, grower.varietyId));

    const transporter = await createTestCompany(
      `מוביל בדיקה ${crypto.randomUUID()}`,
      "transporter",
    );
    // Pushed after setUpDayWithSupplyAndDemand's own registrations, so
    // LIFO runs this BEFORE the day itself is deleted — meaning the day's
    // own notification_outbox rows (including the one this test creates,
    // addressed to the transporter) still exist at this point, and
    // notification_outbox.recipient_company_id has no ON DELETE action
    // (RESTRICT). Deleting that specific row directly first, rather than
    // relying on the day's later cascade, avoids the FK violation
    // regardless of ordering relative to the day's own cleanup — and
    // avoids a thrown error here aborting the REST of runCleanup's LIFO
    // chain (it doesn't catch — one throw skips every cleanup queued
    // before it), which is what actually left a trading day stuck the
    // first time this test ran.
    cleanupFns.push(async () => {
      await db
        .delete(notificationOutbox)
        .where(eq(notificationOutbox.recipientCompanyId, transporter.id));
      await db
        .update(companies)
        .set({ transporterCompanyId: null })
        .where(eq(companies.id, grower.companyId));
      await deleteTestCompany(transporter.id);
    });
    await db
      .update(companies)
      .set({ transporterCompanyId: transporter.id })
      .where(eq(companies.id, grower.companyId));

    const created = await admin.client.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({
        dailyPickProductId: pickProductId,
        dailyOrderProductId: orderProductId,
        quantityPallets: 5,
      }),
    );
    expect(created.error).toBeNull();

    await db
      .update(dailyOrders)
      .set({ status: "submitted" })
      .where(
        and(eq(dailyOrders.tradingDayId, day.id), eq(dailyOrders.customerCompanyId, customer.id)),
      );

    const closeShop = await admin.client.rpc("close_shop");
    expect(closeShop.error).toBeNull();
    const closeArrangement = await admin.client.rpc("close_arrangement");
    expect(closeArrangement.error).toBeNull();

    const { data: outboxRows } = await admin.client
      .from("notification_outbox")
      .select("recipient_type, recipient_company_id, template_key")
      .eq("trading_day_id", day.id);
    const transporterRows = outboxRows?.filter((row) => row.recipient_type === "transporter") ?? [];
    expect(transporterRows).toHaveLength(1);
    expect(transporterRows[0]).toMatchObject({
      recipient_company_id: transporter.id,
      template_key: "close_arrangement_grower",
    });
  }, 30000);
});
