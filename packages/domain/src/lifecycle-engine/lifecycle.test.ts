import { randomUUID } from "node:crypto";

import { db } from "@ori/db";
import { companies, notificationOutbox } from "@ori/db/schema";
import {
  createTestBackofficeAdmin,
  createTestCompany,
  createTestProfile,
  deleteTestBackofficeAdmin,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "@ori/domain/auth/testing";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  LIFECYCLE_ERROR_CODES,
  toInitiateBusinessDayRpcArgs,
  toOpenShopRpcArgs,
  toRevertPickToDraftRpcArgs,
  toSubmitPickRpcArgs,
  toUpdatePickProductPalletsRpcArgs,
} from "./schemas";
import {
  createTestArrangementRecord,
  createTestGrowerWithProduct,
  createTestOrderProductLine,
  createTestTradingDay,
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
  getDailyPickForGrower,
  getPickProductLine,
} from "./test-helpers";

// Every test here owns exactly one trading day, start to finish, and
// tears it down in its own afterEach before the next test runs. This
// isn't just tidiness: Lifecycle Invariant 1 ("at most one trading day is
// ever open at a time") is enforced GLOBALLY, not per-fixture, unlike
// every other constraint this project's tests have exercised so far — two
// tests with an open day at the same moment would collide on the exact
// mechanism this suite is trying to prove works. Keeping every test in
// one file, run sequentially (vitest's default — nothing here uses
// `.concurrent`), is what makes that safe.
describe("lifecycle engine", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  async function signedInBackoffice() {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    return signInTestUser(admin.email, admin.password);
  }

  async function signedInGrowerFor(growerCompanyId: string) {
    const grower = await createTestProfile({ companyId: growerCompanyId, role: "grower" });
    cleanupFns.push(() => deleteTestUser(grower.userId));
    return signInTestUser(grower.email, grower.password);
  }

  it("walks all four phases in order, holding Invariants 1, 2, 3, 4, and 5", async () => {
    // This test alone makes ~15 round trips to the real remote Supabase
    // project (fixtures, sign-ins, four RPC calls, several verifying
    // selects) — comfortably past vitest's 5s default. Letting it time
    // out is actively harmful here, not just slow: vitest moves on to
    // afterEach while this test's own promise chain is still running in
    // the background (Node has no true cancellation), so cleanup can run
    // against a half-populated `cleanupFns` array while the abandoned
    // chain is still creating rows — exactly the kind of FK-violation
    // flake a short timeout would otherwise cause here.
    const submittingGrower = await createTestGrowerWithProduct({ defaultPickupTime: "06:30" });
    cleanupFns.push(() => deleteTestGrowerWithProduct(submittingGrower));
    const noShowGrower = await createTestGrowerWithProduct({ defaultPickupTime: "09:45" });
    cleanupFns.push(() => deleteTestGrowerWithProduct(noShowGrower));
    const customer = await createTestCompany(`לקוח בדיקה ${randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customer.id));

    const backoffice = await signedInBackoffice();
    const tradeDate = new Date().toISOString().slice(0, 10);

    // --- Phase 1: Initiate Business Day ---
    const initiate = await backoffice.rpc(
      "initiate_business_day",
      toInitiateBusinessDayRpcArgs({ tradeDate }),
    );
    expect(initiate.error).toBeNull();
    const day = initiate.data!;
    cleanupFns.push(() => deleteTestTradingDay(day.id));
    expect(day.phase).toBe("initiated");

    // Bootstrap: both growers got a Daily Pick + one pick-product line,
    // starting in Draft.
    const submittingPick = await getDailyPickForGrower(day.id, submittingGrower.companyId);
    const noShowPick = await getDailyPickForGrower(day.id, noShowGrower.companyId);
    expect(submittingPick).toMatchObject({ status: "draft" });
    expect(noShowPick).toMatchObject({ status: "draft" });
    const submittingLine = await getPickProductLine(submittingPick!.id, submittingGrower.varietyId);
    expect(submittingLine).toMatchObject({ palletsPicked: "0.00" });

    // A Daily Arrangement exists for the day, Open.
    const { data: arrangementRows } = await backoffice
      .from("daily_arrangements")
      .select("status")
      .eq("trading_day_id", day.id);
    expect(arrangementRows).toEqual([{ status: "open" }]);

    // Invariant 1: a second initiate, while this one is still open, must
    // fail — not silently orphan the first day's records the way the
    // source did.
    const secondInitiate = await backoffice.rpc(
      "initiate_business_day",
      toInitiateBusinessDayRpcArgs({ tradeDate }),
    );
    expect(secondInitiate.error).not.toBeNull();
    expect(secondInitiate.error?.code).toBe(LIFECYCLE_ERROR_CODES.DAY_ALREADY_OPEN);

    // The grower submits their pick before the shop even opens — allowed
    // per Invariant 4 ("Phase 1-2: Draft or Submitted").
    const growerClient = await signedInGrowerFor(submittingGrower.companyId);
    const submit = await growerClient.rpc(
      "submit_pick",
      toSubmitPickRpcArgs({ dailyPickId: submittingPick!.id }),
    );
    expect(submit.error).toBeNull();
    // submit_pick snapshots the grower's CURRENT company default onto the
    // pick's own pickup_time (0043) — pickup time is a per-grower setting,
    // not a per-product one, and this snapshot is what keeps this record's
    // collection time stable even if the company default is edited later.
    expect(submit.data).toMatchObject({ status: "submitted", pickup_time: "06:30:00" });

    // --- Phase 2: Open Shop ---
    const openShop = await backoffice.rpc("open_shop", toOpenShopRpcArgs({ canSeePrices: true }));
    expect(openShop.error).toBeNull();
    expect(openShop.data).toMatchObject({ trading_day_id: day.id, status: "open" });

    const { data: dayAfterOpen } = await backoffice
      .from("trading_days")
      .select("phase")
      .eq("id", day.id)
      .single();
    expect(dayAfterOpen).toMatchObject({ phase: "shop_open" });

    // Bootstrap: the active customer got a Daily Order header.
    const { data: orderRows } = await backoffice
      .from("daily_orders")
      .select("status")
      .eq("trading_day_id", day.id)
      .eq("customer_company_id", customer.id);
    expect(orderRows).toEqual([{ status: "open" }]);

    // --- Phase 3: Close Shop ---
    const sessionCountBeforeClose = await backoffice
      .from("lifecycle_sessions")
      .select("id", { count: "exact", head: true })
      .eq("trading_day_id", day.id);

    const closeShop = await backoffice.rpc("close_shop");
    expect(closeShop.error).toBeNull();
    expect(closeShop.data).toMatchObject({ trading_day_id: day.id, session_type: "close_shop" });

    const { data: dayAfterCloseShop } = await backoffice
      .from("trading_days")
      .select("phase")
      .eq("id", day.id)
      .single();
    expect(dayAfterCloseShop).toMatchObject({ phase: "shop_closed" });

    const { data: shopAfterClose } = await backoffice
      .from("daily_shops")
      .select("status")
      .eq("trading_day_id", day.id)
      .single();
    expect(shopAfterClose).toMatchObject({ status: "closed" });

    // Invariant 5: exactly one session logged for this real close.
    const sessionCountAfterClose = await backoffice
      .from("lifecycle_sessions")
      .select("id", { count: "exact", head: true })
      .eq("trading_day_id", day.id);
    expect((sessionCountAfterClose.count ?? 0) - (sessionCountBeforeClose.count ?? 0)).toBe(1);

    // The no-show grower's pick is still open — this is legitimate at
    // phase 3 (Invariant 4: picks stay open through phase 3).
    const noShowPickBeforeClose = await getDailyPickForGrower(day.id, noShowGrower.companyId);
    expect(noShowPickBeforeClose).toMatchObject({ status: "draft" });

    // --- Phase 4: Close Arrangement (terminal) ---
    const closeArrangement = await backoffice.rpc("close_arrangement");
    expect(closeArrangement.error).toBeNull();
    expect(closeArrangement.data).toMatchObject({ trading_day_id: day.id, session_type: "end_the_day" });

    const { data: dayAfterClose } = await backoffice
      .from("trading_days")
      .select("phase")
      .eq("id", day.id)
      .single();
    expect(dayAfterClose).toMatchObject({ phase: "closed" });

    const { data: arrangementAfterClose } = await backoffice
      .from("daily_arrangements")
      .select("status, closed_at")
      .eq("trading_day_id", day.id)
      .single();
    expect(arrangementAfterClose?.status).toBe("closed");
    expect(arrangementAfterClose?.closed_at).not.toBeNull();

    // Invariant 4: EVERY pick for the day is Closed, including the
    // no-show — surfaced, not silently folded in, via this session's
    // metadata.
    const submittingPickAfterClose = await getDailyPickForGrower(day.id, submittingGrower.companyId);
    const noShowPickAfterClose = await getDailyPickForGrower(day.id, noShowGrower.companyId);
    expect(submittingPickAfterClose).toMatchObject({ status: "closed" });
    expect(noShowPickAfterClose).toMatchObject({ status: "closed" });

    // close_arrangement's mass pick-close backfills pickup_time (from the
    // grower's current company default) AND submitted_at (0043/0044) for a
    // pick that never went through submit_pick — the no-show — while
    // leaving a pick that already captured its own values at submission
    // untouched.
    const { data: picksAfterClose } = await backoffice
      .from("daily_picks")
      .select("grower_company_id, pickup_time, submitted_at")
      .in("id", [submittingPick!.id, noShowPick!.id]);
    expect(picksAfterClose).toContainEqual(
      expect.objectContaining({
        grower_company_id: submittingGrower.companyId,
        pickup_time: "06:30:00",
        submitted_at: submit.data!.submitted_at,
      }),
    );
    const noShowAfterClose = picksAfterClose!.find(
      (row) => row.grower_company_id === noShowGrower.companyId,
    );
    expect(noShowAfterClose).toMatchObject({ pickup_time: "09:45:00" });
    expect(noShowAfterClose!.submitted_at).not.toBeNull();

    const metadata = closeArrangement.data!.metadata as {
      draftPicksForceClosed: Array<{ dailyPickId: string; growerCompanyId: string }>;
    };
    // Scoped to this test's own two growers rather than asserting the list
    // has exactly one entry. initiate_business_day bootstraps a pick for
    // EVERY active grower with in-season products (0011/0015), so on a
    // database that holds anything besides this fixture — seeded demo
    // growers, another suite's leftovers — every one of those growers is
    // also a no-show and lands in this list. The invariant under test is
    // "the no-show is surfaced, the submitter is not", which is what these
    // two assertions say; the total count was only ever a proxy for it that
    // happened to hold while the database was empty.
    expect(metadata.draftPicksForceClosed).toContainEqual(
      expect.objectContaining({
        dailyPickId: noShowPick!.id,
        growerCompanyId: noShowGrower.companyId,
      }),
    );
    expect(metadata.draftPicksForceClosed).not.toContainEqual(
      expect.objectContaining({ growerCompanyId: submittingGrower.companyId }),
    );

    // Invariant 3: there is no App Settings singleton to "reset" — the
    // real test is that the day's records stay reachable via their FK
    // (already proven above) and that closing this day does not block
    // the very next initiate. No stale reference, no manual field-clear.
    const nextDayInitiate = await backoffice.rpc(
      "initiate_business_day",
      toInitiateBusinessDayRpcArgs({ tradeDate }),
    );
    expect(nextDayInitiate.error).toBeNull();
    cleanupFns.push(() => deleteTestTradingDay(nextDayInitiate.data!.id));
  }, 45000);

  it("initiate_business_day and open_shop each reject a concurrent double-call — the R7 guard", async () => {
    const backoffice = await signedInBackoffice();
    const tradeDate = new Date().toISOString().slice(0, 10);

    const [firstInitiate, secondInitiate] = await Promise.all([
      backoffice.rpc("initiate_business_day", toInitiateBusinessDayRpcArgs({ tradeDate })),
      backoffice.rpc("initiate_business_day", toInitiateBusinessDayRpcArgs({ tradeDate })),
    ]);

    const initiateResults = [firstInitiate, secondInitiate];
    const succeeded = initiateResults.filter((r) => r.error === null);
    const failed = initiateResults.filter((r) => r.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error?.code).toBe(LIFECYCLE_ERROR_CODES.DAY_ALREADY_OPEN);

    const dayId = succeeded[0]!.data!.id;
    cleanupFns.push(() => deleteTestTradingDay(dayId));

    const [firstOpen, secondOpen] = await Promise.all([
      backoffice.rpc("open_shop", toOpenShopRpcArgs({ canSeePrices: true })),
      backoffice.rpc("open_shop", toOpenShopRpcArgs({ canSeePrices: true })),
    ]);

    const openResults = [firstOpen, secondOpen];
    const openSucceeded = openResults.filter((r) => r.error === null);
    const openFailed = openResults.filter((r) => r.error !== null);
    expect(openSucceeded).toHaveLength(1);
    expect(openFailed).toHaveLength(1);
    // Either the unique constraint on daily_shops.trading_day_id fires
    // (SHOP_ALREADY_OPEN), or — because open_shop locks the trading_days
    // row with `for update` before it ever inserts — the second call's
    // SELECT blocks on the first's lock, re-reads the now-committed
    // phase, and rejects on the phase check instead (INVALID_STATE)
    // before it ever reaches the insert. Both are the real guard doing
    // its job; which one fires is a legitimate implementation detail of
    // how the row lock happens to interleave, not something this test
    // should pin to one path.
    expect([LIFECYCLE_ERROR_CODES.SHOP_ALREADY_OPEN, LIFECYCLE_ERROR_CODES.INVALID_STATE]).toContain(
      openFailed[0]!.error?.code,
    );

    // Only one daily_shops row exists for the day, regardless of the race.
    const { data: shops } = await backoffice.from("daily_shops").select("id").eq("trading_day_id", dayId);
    expect(shops).toHaveLength(1);
  });

  it("every phase transition rejects an out-of-order call and logs nothing on that failure — Invariant 5", async () => {
    const backoffice = await signedInBackoffice();
    const admin = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin));

    const day = await createTestTradingDay({ initiatedByUserId: admin.userId, phase: "initiated" });
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    // open_shop expects "initiated" — force the day one phase past that
    // by hand (bypassing the RPC, so this is a single, non-concurrent
    // call exercising the phase check on its own, independent of the
    // `for update` locking that also happens to catch a genuine race).
    await backoffice.from("trading_days").update({ phase: "shop_open" }).eq("id", day.id);
    const openShopOutOfOrder = await backoffice.rpc("open_shop", toOpenShopRpcArgs({ canSeePrices: true }));
    expect(openShopOutOfOrder.error).not.toBeNull();
    expect(openShopOutOfOrder.error?.code).toBe(LIFECYCLE_ERROR_CODES.INVALID_STATE);
    await backoffice.from("trading_days").update({ phase: "initiated" }).eq("id", day.id);

    // The day is only "initiated" — close_shop expects "shop_open".
    const closeShop = await backoffice.rpc("close_shop");
    expect(closeShop.error).not.toBeNull();
    expect(closeShop.error?.code).toBe(LIFECYCLE_ERROR_CODES.INVALID_STATE);

    const { count: sessionsAfterFailedCloseShop } = await backoffice
      .from("lifecycle_sessions")
      .select("id", { count: "exact", head: true })
      .eq("trading_day_id", day.id);
    expect(sessionsAfterFailedCloseShop).toBe(0);

    // Same for close_arrangement — the day hasn't even reached
    // "shop_closed" yet.
    const closeArrangement = await backoffice.rpc("close_arrangement");
    expect(closeArrangement.error).not.toBeNull();
    expect(closeArrangement.error?.code).toBe(LIFECYCLE_ERROR_CODES.INVALID_STATE);

    const { count: sessionsAfterFailedCloseArrangement } = await backoffice
      .from("lifecycle_sessions")
      .select("id", { count: "exact", head: true })
      .eq("trading_day_id", day.id);
    expect(sessionsAfterFailedCloseArrangement).toBe(0);

    // The day's phase itself never moved — a rejected transition is a
    // true no-op, not a partial one.
    const { data: dayNow } = await backoffice.from("trading_days").select("phase").eq("id", day.id).single();
    expect(dayNow).toMatchObject({ phase: "initiated" });
  });

  it("close_shop rejects a genuinely concurrent double-call — two real rpc() calls racing via Promise.all", async () => {
    const backoffice = await signedInBackoffice();
    const admin = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin));

    const day = await createTestTradingDay({ initiatedByUserId: admin.userId, phase: "shop_open" });
    cleanupFns.push(() => deleteTestTradingDay(day.id));
    const directShop = await backoffice
      .from("daily_shops")
      .insert({ trading_day_id: day.id, opened_by: admin.userId })
      .select()
      .single();
    expect(directShop.error).toBeNull();

    // Both calls are fired before either is awaited — this is a genuine
    // race, not two sequential calls where the second trivially fails
    // because the first already committed.
    const [first, second] = await Promise.all([
      backoffice.rpc("close_shop"),
      backoffice.rpc("close_shop"),
    ]);

    const results = [first, second];
    const succeeded = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    // The loser's SELECT ... FOR UPDATE blocks on the winner's row lock,
    // then re-reads the now-committed phase ("shop_closed") and fails the
    // explicit phase check — not a unique-constraint race, since nothing
    // here is uniquely constrained; this IS the guard in action.
    expect(failed[0]!.error?.code).toBe(LIFECYCLE_ERROR_CODES.INVALID_STATE);

    const { data: sessions } = await backoffice
      .from("lifecycle_sessions")
      .select("id")
      .eq("trading_day_id", day.id)
      .eq("session_type", "close_shop");
    expect(sessions).toHaveLength(1);

    const { data: dayAfter } = await backoffice.from("trading_days").select("phase").eq("id", day.id).single();
    expect(dayAfter).toMatchObject({ phase: "shop_closed" });
  });

  it("close_arrangement rejects a genuinely concurrent double-call — two real rpc() calls racing via Promise.all", async () => {
    const backoffice = await signedInBackoffice();
    const admin = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin));

    const day = await createTestTradingDay({ initiatedByUserId: admin.userId, phase: "shop_closed" });
    cleanupFns.push(() => deleteTestTradingDay(day.id));
    const directArrangement = await backoffice
      .from("daily_arrangements")
      .insert({ trading_day_id: day.id, status: "open" })
      .select()
      .single();
    expect(directArrangement.error).toBeNull();

    const [first, second] = await Promise.all([
      backoffice.rpc("close_arrangement"),
      backoffice.rpc("close_arrangement"),
    ]);

    const results = [first, second];
    const succeeded = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    // Unlike close_shop (which moves the day to "shop_closed" — still
    // matched by `phase <> 'closed'`, so the loser's SELECT finds the row
    // and fails the explicit phase check with INVALID_STATE),
    // close_arrangement moves the day all the way to "closed" — the
    // loser's SELECT, unblocked after the winner commits, re-evaluates
    // `phase <> 'closed'` against that now-committed row and finds NO
    // rows at all, hitting the "not found" branch (NOT_FOUND) instead.
    // Both are the same `for update` serialization catching the same
    // race; which not-found-shaped error surfaces depends on whether the
    // winning transition leaves the row inside or outside the query's own
    // WHERE clause — not something this test should pin to one path.
    expect([LIFECYCLE_ERROR_CODES.INVALID_STATE, LIFECYCLE_ERROR_CODES.NOT_FOUND]).toContain(
      failed[0]!.error?.code,
    );

    // This is the exact scenario the source's documented double-click bug
    // produced (a duplicate Session row) — here there is exactly one.
    const { data: sessions } = await backoffice
      .from("lifecycle_sessions")
      .select("id")
      .eq("trading_day_id", day.id)
      .eq("session_type", "end_the_day");
    expect(sessions).toHaveLength(1);

    const { data: dayAfter } = await backoffice.from("trading_days").select("phase").eq("id", day.id).single();
    expect(dayAfter).toMatchObject({ phase: "closed" });
  });

  it("the arrangement-edit rule: pallets_picked can never drop below what's already arranged", async () => {
    const backoffice = await signedInBackoffice();
    const admin = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin));

    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const customer = await createTestCompany(`לקוח בדיקה ${randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customer.id));

    // Created directly at "shop_closed" (not via initiate_business_day)
    // since this test needs a specific phase and its own hand-built pick
    // line, not a full bootstrap — the bootstrap itself is covered by the
    // first test in this file.
    const day = await createTestTradingDay({ initiatedByUserId: admin.userId, phase: "shop_closed" });
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const growerClient = await signedInGrowerFor(grower.companyId);

    // createTestTradingDay is a direct insert — unlike
    // initiate_business_day, it doesn't create the day's Daily
    // Arrangement, so that (and the pick line below) is built by hand too.
    const directArrangement = await backoffice
      .from("daily_arrangements")
      .insert({ trading_day_id: day.id, status: "open" })
      .select()
      .single();
    expect(directArrangement.error).toBeNull();

    const directPick = await backoffice
      .from("daily_picks")
      .insert({ trading_day_id: day.id, grower_company_id: grower.companyId, status: "submitted" })
      .select()
      .single();
    expect(directPick.error).toBeNull();
    const dailyPickId = directPick.data!.id;

    const directLine = await backoffice
      .from("daily_pick_products")
      .insert({ daily_pick_id: dailyPickId, product_variety_id: grower.varietyId, pallets_picked: "10" })
      .select()
      .single();
    expect(directLine.error).toBeNull();
    const lineId = directLine.data!.id;

    const orderLine = await createTestOrderProductLine(day.id, customer.id, grower.varietyId, 6);
    await createTestArrangementRecord({
      dailyArrangementId: directArrangement.data!.id,
      dailyPickProductId: lineId,
      dailyOrderProductId: orderLine.id,
      customerCompanyId: customer.id,
      quantityPallets: 6,
    });

    // Below the arranged floor (6) — rejected.
    const belowFloor = await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: lineId, palletsPicked: 5 }),
    );
    expect(belowFloor.error).not.toBeNull();
    expect(belowFloor.error?.code).toBe(LIFECYCLE_ERROR_CODES.ARRANGED_FLOOR_VIOLATION);

    // Exactly at the floor — allowed (the boundary case).
    const atFloor = await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: lineId, palletsPicked: 6 }),
    );
    expect(atFloor.error).toBeNull();
    // PostgREST/supabase-js parses `numeric` columns as JS numbers here
    // (unlike Drizzle's own numeric mapping, which is a string — see
    // getPickProductLine's assertion above, read via Drizzle directly).
    expect(atFloor.data).toMatchObject({ pallets_picked: 6 });

    // Above the floor — trivially allowed.
    const aboveFloor = await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: lineId, palletsPicked: 20 }),
    );
    expect(aboveFloor.error).toBeNull();
    expect(aboveFloor.data).toMatchObject({ pallets_picked: 20 });

    // A different grower can't touch this line at all.
    const otherGrower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(otherGrower));
    const otherGrowerClient = await signedInGrowerFor(otherGrower.companyId);
    const forbidden = await otherGrowerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: lineId, palletsPicked: 100 }),
    );
    expect(forbidden.error).not.toBeNull();
    expect(forbidden.error?.code).toBe(LIFECYCLE_ERROR_CODES.FORBIDDEN);
  }, 30000);

  it("a closed pick rejects further edits, and submit_pick is forward-only and grower-scoped", async () => {
    const backoffice = await signedInBackoffice();
    const admin = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin));

    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const day = await createTestTradingDay({ initiatedByUserId: admin.userId, phase: "initiated" });
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const growerClient = await signedInGrowerFor(grower.companyId);

    const directPick = await backoffice
      .from("daily_picks")
      .insert({ trading_day_id: day.id, grower_company_id: grower.companyId, status: "draft" })
      .select()
      .single();
    const dailyPickId = directPick.data!.id;
    const directLine = await backoffice
      .from("daily_pick_products")
      .insert({ daily_pick_id: dailyPickId, product_variety_id: grower.varietyId, pallets_picked: "0" })
      .select()
      .single();
    const lineId = directLine.data!.id;

    // Draft -> Submitted: allowed.
    const submit = await growerClient.rpc("submit_pick", toSubmitPickRpcArgs({ dailyPickId }));
    expect(submit.error).toBeNull();
    expect(submit.data).toMatchObject({ status: "submitted" });

    // Submitting again (not draft anymore): rejected, forward-only.
    const resubmit = await growerClient.rpc("submit_pick", toSubmitPickRpcArgs({ dailyPickId }));
    expect(resubmit.error).not.toBeNull();
    expect(resubmit.error?.code).toBe(LIFECYCLE_ERROR_CODES.INVALID_STATE);

    // A grower can still edit a Submitted pick's lines.
    const editWhileSubmitted = await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: lineId, palletsPicked: 7 }),
    );
    expect(editWhileSubmitted.error).toBeNull();

    // Force the pick closed directly (standing in for close_arrangement's
    // mass-close, already covered end to end in the first test).
    await backoffice.from("daily_picks").update({ status: "closed" }).eq("id", dailyPickId);

    const editWhileClosed = await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: lineId, palletsPicked: 8 }),
    );
    expect(editWhileClosed.error).not.toBeNull();
    expect(editWhileClosed.error?.code).toBe(LIFECYCLE_ERROR_CODES.INVALID_STATE);

    // Another grower's client can't submit or edit this pick either.
    const otherGrower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(otherGrower));
    const otherGrowerClient = await signedInGrowerFor(otherGrower.companyId);
    const forbiddenSubmit = await otherGrowerClient.rpc("submit_pick", toSubmitPickRpcArgs({ dailyPickId }));
    expect(forbiddenSubmit.error).not.toBeNull();
    expect(forbiddenSubmit.error?.code).toBe(LIFECYCLE_ERROR_CODES.FORBIDDEN);
  }, 30000);

  // revert_pick_to_draft (0044) is the one deliberate exception to this
  // module's otherwise forward-only rule — the arrangement board's truck
  // icon. Proves: backoffice-only, only accepts a submitted pick, clears
  // submitted_at AND the pickup_time snapshot (0043) so a later
  // re-submission captures the company's default fresh rather than the
  // stale one from before the revert, and a closed pick can never be
  // reverted.
  it("revert_pick_to_draft is backoffice-only, only reverts a submitted pick, and clears its pickup_time snapshot for a fresh re-submission", async () => {
    const backoffice = await signedInBackoffice();
    const admin = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin));

    const grower = await createTestGrowerWithProduct({ defaultPickupTime: "07:00" });
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const day = await createTestTradingDay({ initiatedByUserId: admin.userId, phase: "initiated" });
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const growerClient = await signedInGrowerFor(grower.companyId);

    const directPick = await backoffice
      .from("daily_picks")
      .insert({ trading_day_id: day.id, grower_company_id: grower.companyId, status: "draft" })
      .select()
      .single();
    const dailyPickId = directPick.data!.id;

    // Still draft: nothing to revert.
    const revertWhileDraft = await backoffice.rpc(
      "revert_pick_to_draft",
      toRevertPickToDraftRpcArgs({ dailyPickId }),
    );
    expect(revertWhileDraft.error).not.toBeNull();
    expect(revertWhileDraft.error?.code).toBe(LIFECYCLE_ERROR_CODES.INVALID_STATE);

    const submit = await growerClient.rpc("submit_pick", toSubmitPickRpcArgs({ dailyPickId }));
    expect(submit.error).toBeNull();
    expect(submit.data).toMatchObject({ status: "submitted", pickup_time: "07:00:00" });

    // The grower can't revert their own submission — this is a
    // distributor-side control, unlike submit_pick's "owning grower, or
    // backoffice".
    const forbidden = await growerClient.rpc(
      "revert_pick_to_draft",
      toRevertPickToDraftRpcArgs({ dailyPickId }),
    );
    expect(forbidden.error).not.toBeNull();
    expect(forbidden.error?.code).toBe(LIFECYCLE_ERROR_CODES.FORBIDDEN);

    const revert = await backoffice.rpc("revert_pick_to_draft", toRevertPickToDraftRpcArgs({ dailyPickId }));
    expect(revert.error).toBeNull();
    expect(revert.data).toMatchObject({ status: "draft", submitted_at: null, pickup_time: null });

    // The distributor changes the grower's default before it's submitted
    // again — proves the clear-on-revert is what lets the next submission
    // pick up the NEW value rather than replaying the stale one.
    await db.update(companies).set({ defaultPickupTime: "11:15" }).where(eq(companies.id, grower.companyId));

    const resubmit = await growerClient.rpc("submit_pick", toSubmitPickRpcArgs({ dailyPickId }));
    expect(resubmit.error).toBeNull();
    expect(resubmit.data).toMatchObject({ status: "submitted", pickup_time: "11:15:00" });

    // Force the pick closed (standing in for close_arrangement's mass
    // close) — a closed pick can never be reverted either.
    await backoffice.from("daily_picks").update({ status: "closed" }).eq("id", dailyPickId);
    const revertWhileClosed = await backoffice.rpc(
      "revert_pick_to_draft",
      toRevertPickToDraftRpcArgs({ dailyPickId }),
    );
    expect(revertWhileClosed.error).not.toBeNull();
    expect(revertWhileClosed.error?.code).toBe(LIFECYCLE_ERROR_CODES.INVALID_STATE);
  }, 30000);

  it("open_shop enqueues one shop_open notification per active customer, none for an inactive one — id 4", async () => {
    const admin = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin));
    const backoffice = await signInTestUser(admin.email, admin.password);

    const activeCustomer = await createTestCompany(`Test Active Customer ${randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(activeCustomer.id));
    const inactiveCustomer = await createTestCompany(`Test Inactive Customer ${randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(inactiveCustomer.id));
    await backoffice.from("companies").update({ status: "inactive" }).eq("id", inactiveCustomer.id);

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await backoffice.rpc("initiate_business_day", toInitiateBusinessDayRpcArgs({ tradeDate }));
    expect(initiate.error).toBeNull();
    const day = initiate.data!;
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const openShop = await backoffice.rpc("open_shop", toOpenShopRpcArgs({ canSeePrices: true }));
    expect(openShop.error).toBeNull();

    const activeRows = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, activeCustomer.id));
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]).toMatchObject({
      templateKey: "shop_open",
      recipientType: "customer",
      tradingDayId: day.id,
    });

    const inactiveRows = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, inactiveCustomer.id));
    expect(inactiveRows).toHaveLength(0);
  }, 30000);

  it("update_pick_product_pallets enqueues pick_updated to backoffice only when the grower themselves edits, not on the backoffice-on-behalf-of path — id 3", async () => {
    const admin = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin));
    const backoffice = await signInTestUser(admin.email, admin.password);

    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await backoffice.rpc("initiate_business_day", toInitiateBusinessDayRpcArgs({ tradeDate }));
    expect(initiate.error).toBeNull();
    const day = initiate.data!;
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const pick = await getDailyPickForGrower(day.id, grower.companyId);
    const line = await getPickProductLine(pick!.id, grower.varietyId);

    // Backoffice editing on the grower's behalf (distributor-grower
    // screen) must NOT self-notify.
    const backofficeEdit = await backoffice.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: line!.id, palletsPicked: 3 }),
    );
    expect(backofficeEdit.error).toBeNull();
    const afterBackofficeEdit = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, admin.companyId));
    expect(afterBackofficeEdit).toHaveLength(0);

    // The grower editing their own line does notify backoffice.
    const growerClient = await signedInGrowerFor(grower.companyId);
    const growerEdit = await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: line!.id, palletsPicked: 6 }),
    );
    expect(growerEdit.error).toBeNull();

    const afterGrowerEdit = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, admin.companyId));
    expect(afterGrowerEdit).toHaveLength(1);
    expect(afterGrowerEdit[0]).toMatchObject({
      templateKey: "pick_updated",
      recipientType: "backoffice",
      tradingDayId: day.id,
    });
  }, 30000);
});
