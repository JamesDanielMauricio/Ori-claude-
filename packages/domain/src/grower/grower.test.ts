import { db } from "@ori/db";
import { arrangementRecords, dailyArrangements, notificationOutbox } from "@ori/db/schema";
import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "@ori/domain/auth/testing";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { toUpdatePickProductPalletsRpcArgs } from "../lifecycle-engine/schemas";
import {
  createTestArrangementRecord,
  createTestGrowerWithProduct,
  createTestOrderProductLine,
  createTestTradingDay,
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
  getPickProductLine,
} from "../lifecycle-engine/test-helpers";

import {
  GROWER_ERROR_CODES,
  toBootstrapGrowerPickRpcArgs,
  toCloseOutPickLeftoversRpcArgs,
  toSavePickLinesRpcArgs,
  toSendPickReminderRpcArgs,
  toUpdatePickProductDetailsRpcArgs,
} from "./schemas";
import { addGrowerProduct, deleteTestProductVariety, removeGrowerProduct } from "./test-helpers";

// Every fixture trading day here is created directly at phase "closed" —
// none of this module's functions (0015) read trading_days.phase at all,
// and phase "closed" is the one value excluded from the partial unique
// index that enforces "at most one open trading day" (0009). That lets
// this file run fully in parallel with lifecycle.test.ts (and with
// itself) without colliding on that global constraint, unlike
// lifecycle.test.ts's own tests which genuinely need an open day.
describe("grower picking module", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  async function signedInBackoffice() {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    return { client: await signInTestUser(admin.email, admin.password), userId: admin.userId };
  }

  async function signedInGrowerFor(growerCompanyId: string) {
    const grower = await createTestProfile({ companyId: growerCompanyId, role: "grower" });
    cleanupFns.push(() => deleteTestUser(grower.userId));
    return signInTestUser(grower.email, grower.password);
  }

  // Deliberately does NOT push its own cleanup: arrangement_records and
  // product_varieties FKs referencing this day's pick lines have no
  // ON DELETE CASCADE back the other way, so the day (and everything it
  // cascades to — daily_picks, daily_pick_products, arrangement_records)
  // must be torn down BEFORE any customer/product fixture created after
  // it. Since runCleanup is LIFO, callers push this day's own cleanup
  // last, after every other fixture created alongside it, so it runs
  // first.
  async function createClosedTestDay(initiatedByUserId: string) {
    const day = await createTestTradingDay({ initiatedByUserId, phase: "closed" });
    const [arrangement] = await db
      .insert(dailyArrangements)
      .values({ tradingDayId: day.id, status: "open" })
      .returning();
    if (!arrangement) throw new Error("failed to create test daily arrangement");
    return { day, arrangement };
  }

  it("bootstrap_grower_pick is idempotent: preserves an edited line, adds a newly in-season product, and prunes a removed one", async () => {
    const { client: backoffice, userId: adminId } = await signedInBackoffice();
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const { day } = await createClosedTestDay(adminId);

    // First call: creates the Daily Pick and its one line.
    const first = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    expect(first.error).toBeNull();
    const pickId = first.data!.id;
    const firstLine = await getPickProductLine(pickId, grower.varietyId);
    expect(firstLine).toMatchObject({ palletsPicked: "0.00" });

    // The grower enters a real pallet count.
    const growerClient = await signedInGrowerFor(grower.companyId);
    const edit = await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: firstLine!.id, palletsPicked: 7 }),
    );
    expect(edit.error).toBeNull();

    // Second call with nothing changed: same pick, existing line's value
    // untouched — the `on conflict do nothing` upsert, not a temp-record
    // rerun.
    const second = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    expect(second.error).toBeNull();
    expect(second.data!.id).toBe(pickId);
    const afterSecondCall = await getPickProductLine(pickId, grower.varietyId);
    expect(afterSecondCall).toMatchObject({ id: firstLine!.id, palletsPicked: "7.00" });

    // The distributor adds a new in-season product mid-day — a third call
    // adds its line without disturbing the first.
    const secondProduct = await addGrowerProduct(grower.companyId);
    cleanupFns.push(() => deleteTestProductVariety(secondProduct));
    cleanupFns.push(() => deleteTestTradingDay(day.id));
    const third = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    expect(third.error).toBeNull();
    expect(third.data!.id).toBe(pickId);
    const newLine = await getPickProductLine(pickId, secondProduct.varietyId);
    expect(newLine).toMatchObject({ palletsPicked: "0.00" });
    const stillThere = await getPickProductLine(pickId, grower.varietyId);
    expect(stillThere).toMatchObject({ id: firstLine!.id, palletsPicked: "7.00" });

    // The distributor drops BOTH products from the grower's in-season
    // list — a fourth call prunes only the untouched one (secondProduct,
    // still 0 pallets); the first line survives despite also leaving
    // season, because it has real picked data (0016's prune guard — see
    // the dedicated test below for the arrangement_records case).
    await removeGrowerProduct(grower.companyId, grower.varietyId);
    await removeGrowerProduct(grower.companyId, secondProduct.varietyId);
    const fourth = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    expect(fourth.error).toBeNull();
    const pruned = await getPickProductLine(pickId, secondProduct.varietyId);
    expect(pruned).toBeNull();
    const survivedLine = await getPickProductLine(pickId, grower.varietyId);
    expect(survivedLine).toMatchObject({ id: firstLine!.id, palletsPicked: "7.00" });
  }, 30000);

  // bootstrap_grower_pick is not Phase-1-only: the distributor's "add
  // products" action calls it again mid-day, any time after save_grower
  // changes a grower's in-season list — by which point real picking or
  // arrangement activity may already exist against a line whose product
  // just left the list. This test drives exactly that re-run scenario for
  // all three cases the prune step has to distinguish (0016).
  it("bootstrap_grower_pick's prune step only removes an untouched line — a picked or arranged line survives a mid-day re-run, and the call is backoffice-only", async () => {
    const { client: backoffice, userId: adminId } = await signedInBackoffice();
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const { day, arrangement } = await createClosedTestDay(adminId);
    const customer = await createTestCompany("Test Customer", "customer");
    cleanupFns.push(() => deleteTestCompany(customer.id));

    const pickedProduct = await addGrowerProduct(grower.companyId);
    cleanupFns.push(() => deleteTestProductVariety(pickedProduct));
    const arrangedProduct = await addGrowerProduct(grower.companyId);
    cleanupFns.push(() => deleteTestProductVariety(arrangedProduct));
    // Pushed after every fixture created alongside the day: LIFO means
    // this day's cleanup (which cascades away any surviving
    // arrangement_record/line below) must run BEFORE the customer/product
    // fixtures are deleted — see createClosedTestDay's comment.
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const bootstrap = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    expect(bootstrap.error).toBeNull();
    const pickId = bootstrap.data!.id;

    // Untouched: 0 pallets, nothing arranged — this is the case that
    // SHOULD still be pruned.
    const untouchedLine = await getPickProductLine(pickId, grower.varietyId);
    expect(untouchedLine).toMatchObject({ palletsPicked: "0.00" });

    // Picked but unarranged: real grower data, no arrangement_records.
    const pickedLine = await getPickProductLine(pickId, pickedProduct.varietyId);
    const growerClient = await signedInGrowerFor(grower.companyId);
    const pick = await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: pickedLine!.id, palletsPicked: 5 }),
    );
    expect(pick.error).toBeNull();

    // Arranged: has a real arrangement_records row against it.
    const arrangedLine = await getPickProductLine(pickId, arrangedProduct.varietyId);
    const orderLine = await createTestOrderProductLine(day.id, customer.id, arrangedProduct.varietyId, 3);
    const record = await createTestArrangementRecord({
      dailyArrangementId: arrangement.id,
      dailyPickProductId: arrangedLine!.id,
      dailyOrderProductId: orderLine.id,
      customerCompanyId: customer.id,
      quantityPallets: 3,
    });

    // The distributor drops all three products from the grower's
    // in-season list, then re-invokes bootstrap_grower_pick mid-day
    // (exactly what "add products" does after save_grower).
    await removeGrowerProduct(grower.companyId, grower.varietyId);
    await removeGrowerProduct(grower.companyId, pickedProduct.varietyId);
    await removeGrowerProduct(grower.companyId, arrangedProduct.varietyId);
    const rerun = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    expect(rerun.error).toBeNull();

    expect(await getPickProductLine(pickId, grower.varietyId)).toBeNull();
    expect(await getPickProductLine(pickId, pickedProduct.varietyId)).toMatchObject({
      id: pickedLine!.id,
      palletsPicked: "5.00",
    });
    expect(await getPickProductLine(pickId, arrangedProduct.varietyId)).toMatchObject({
      id: arrangedLine!.id,
    });
    const remainingRecords = await db
      .select()
      .from(arrangementRecords)
      .where(eq(arrangementRecords.id, record.id));
    expect(remainingRecords).toHaveLength(1);

    const forbidden = await growerClient.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    expect(forbidden.error).not.toBeNull();
    expect(forbidden.error?.code).toBe(GROWER_ERROR_CODES.FORBIDDEN);
  }, 30000);

  it("close_out_pick_leftovers sets pallets_picked minus arranged per line, and is backoffice-only", async () => {
    const { client: backoffice, userId: adminId } = await signedInBackoffice();
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const { day, arrangement } = await createClosedTestDay(adminId);
    const customer = await createTestCompany("Test Customer", "customer");
    cleanupFns.push(() => deleteTestCompany(customer.id));
    // See the sibling "pruning" test above for why this must be pushed
    // after the customer.
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const bootstrap = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    const pickId = bootstrap.data!.id;
    const line = await getPickProductLine(pickId, grower.varietyId);

    const growerClient = await signedInGrowerFor(grower.companyId);
    await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: line!.id, palletsPicked: 10 }),
    );
    const orderLine = await createTestOrderProductLine(day.id, customer.id, grower.varietyId, 6);
    await createTestArrangementRecord({
      dailyArrangementId: arrangement.id,
      dailyPickProductId: line!.id,
      dailyOrderProductId: orderLine.id,
      customerCompanyId: customer.id,
      quantityPallets: 6,
    });

    const forbidden = await growerClient.rpc(
      "close_out_pick_leftovers",
      toCloseOutPickLeftoversRpcArgs({ tradingDayId: day.id }),
    );
    expect(forbidden.error).not.toBeNull();
    expect(forbidden.error?.code).toBe(GROWER_ERROR_CODES.FORBIDDEN);

    const closeOut = await backoffice.rpc(
      "close_out_pick_leftovers",
      toCloseOutPickLeftoversRpcArgs({ tradingDayId: day.id }),
    );
    expect(closeOut.error).toBeNull();
    expect(closeOut.data).toBe(1);

    const afterClose = await getPickProductLine(pickId, grower.varietyId);
    expect(afterClose).toMatchObject({ leftoverPallets: "4.00" });
  }, 30000);

  it("close_out_pick_leftovers treats an unarranged line as fully leftover", async () => {
    const { client: backoffice, userId: adminId } = await signedInBackoffice();
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const { day } = await createClosedTestDay(adminId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const bootstrap = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    const pickId = bootstrap.data!.id;
    const line = await getPickProductLine(pickId, grower.varietyId);

    const growerClient = await signedInGrowerFor(grower.companyId);
    await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: line!.id, palletsPicked: 8 }),
    );

    const closeOut = await backoffice.rpc(
      "close_out_pick_leftovers",
      toCloseOutPickLeftoversRpcArgs({ tradingDayId: day.id }),
    );
    expect(closeOut.error).toBeNull();

    const afterClose = await getPickProductLine(pickId, grower.varietyId);
    expect(afterClose).toMatchObject({ leftoverPallets: "8.00" });
  }, 30000);

  it("bootstrap_grower_pick carries leftover_pallets forward from the grower's most recent prior line for the same variety (migration 0050)", async () => {
    const { client: backoffice, userId: adminId } = await signedInBackoffice();
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    // Day 1: picked 10, 5 arranged to a customer, day closes — leaves
    // leftover_pallets = 5 on day 1's own line.
    const day1 = await createTestTradingDay({
      initiatedByUserId: adminId,
      tradeDate: "2020-01-01",
      phase: "closed",
    });
    const [arrangement1] = await db
      .insert(dailyArrangements)
      .values({ tradingDayId: day1.id, status: "open" })
      .returning();
    if (!arrangement1) throw new Error("failed to create test daily arrangement");

    const bootstrap1 = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day1.id, growerCompanyId: grower.companyId }),
    );
    const pick1Id = bootstrap1.data!.id;
    const line1 = await getPickProductLine(pick1Id, grower.varietyId);

    const growerClient = await signedInGrowerFor(grower.companyId);
    await growerClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: line1!.id, palletsPicked: 10 }),
    );

    const customer = await createTestCompany("Test Customer", "customer");
    cleanupFns.push(() => deleteTestCompany(customer.id));

    const orderLine = await createTestOrderProductLine(day1.id, customer.id, grower.varietyId, 5);
    await createTestArrangementRecord({
      dailyArrangementId: arrangement1.id,
      dailyPickProductId: line1!.id,
      dailyOrderProductId: orderLine.id,
      customerCompanyId: customer.id,
      quantityPallets: 5,
    });

    const closeOut = await backoffice.rpc(
      "close_out_pick_leftovers",
      toCloseOutPickLeftoversRpcArgs({ tradingDayId: day1.id }),
    );
    expect(closeOut.error).toBeNull();
    expect(await getPickProductLine(pick1Id, grower.varietyId)).toMatchObject({
      leftoverPallets: "5.00",
    });

    // Day 2, a later trading day for the same grower — pushed after the
    // customer fixture, matching createClosedTestDay's own LIFO-ordering
    // comment (a day's cascade must clear before fixtures created alongside
    // it can be deleted). Day 1 is pushed after day 2 so it tears down
    // second, once day 2's own cascade (which references nothing of day 1's)
    // is already gone.
    cleanupFns.push(() => deleteTestTradingDay(day1.id));
    const day2 = await createTestTradingDay({
      initiatedByUserId: adminId,
      tradeDate: "2020-01-02",
      phase: "closed",
    });
    cleanupFns.push(() => deleteTestTradingDay(day2.id));

    const bootstrap2 = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day2.id, growerCompanyId: grower.companyId }),
    );
    expect(bootstrap2.error).toBeNull();
    const pick2Id = bootstrap2.data!.id;

    // The new day's line starts with today's picking at 0 (nothing picked
    // yet) but leftover already carried in from day 1's close.
    expect(await getPickProductLine(pick2Id, grower.varietyId)).toMatchObject({
      palletsPicked: "0.00",
      leftoverPallets: "5.00",
    });
  }, 30000);

  it("update_pick_product_details lets the owning grower (or backoffice) set the comment, rejects other growers, and rejects edits once the pick is closed", async () => {
    const { client: backoffice, userId: adminId } = await signedInBackoffice();
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const { day } = await createClosedTestDay(adminId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const bootstrap = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    const pickId = bootstrap.data!.id;
    const line = await getPickProductLine(pickId, grower.varietyId);

    const growerClient = await signedInGrowerFor(grower.companyId);
    const edit = await growerClient.rpc(
      "update_pick_product_details",
      toUpdatePickProductDetailsRpcArgs({
        dailyPickProductId: line!.id,
        comment: "gate code 1234",
      }),
    );
    expect(edit.error).toBeNull();
    expect(edit.data).toMatchObject({ comment: "gate code 1234" });

    const backofficeEdit = await backoffice.rpc(
      "update_pick_product_details",
      toUpdatePickProductDetailsRpcArgs({ dailyPickProductId: line!.id, comment: "cleared" }),
    );
    expect(backofficeEdit.error).toBeNull();
    expect(backofficeEdit.data).toMatchObject({ comment: "cleared" });

    const otherGrower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(otherGrower));
    const otherGrowerClient = await signedInGrowerFor(otherGrower.companyId);
    const forbidden = await otherGrowerClient.rpc(
      "update_pick_product_details",
      toUpdatePickProductDetailsRpcArgs({ dailyPickProductId: line!.id, comment: "nope" }),
    );
    expect(forbidden.error).not.toBeNull();
    expect(forbidden.error?.code).toBe(GROWER_ERROR_CODES.FORBIDDEN);

    await backoffice.from("daily_picks").update({ status: "closed" }).eq("id", pickId);
    const afterClose = await growerClient.rpc(
      "update_pick_product_details",
      toUpdatePickProductDetailsRpcArgs({ dailyPickProductId: line!.id, comment: "too late" }),
    );
    expect(afterClose.error).not.toBeNull();
    expect(afterClose.error?.code).toBe(GROWER_ERROR_CODES.INVALID_STATE);
  }, 30000);

  it("send_pick_reminder stamps reminder_sent_at, dispatches one pick_reminder outbox row, is backoffice-only, and rejects a closed pick", async () => {
    const { client: backoffice, userId: adminId } = await signedInBackoffice();
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const { day } = await createClosedTestDay(adminId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const bootstrap = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    const pickId = bootstrap.data!.id;

    const growerClient = await signedInGrowerFor(grower.companyId);
    const forbidden = await growerClient.rpc(
      "send_pick_reminder",
      toSendPickReminderRpcArgs({ dailyPickId: pickId }),
    );
    expect(forbidden.error).not.toBeNull();
    expect(forbidden.error?.code).toBe(GROWER_ERROR_CODES.FORBIDDEN);

    const reminder = await backoffice.rpc("send_pick_reminder", toSendPickReminderRpcArgs({ dailyPickId: pickId }));
    expect(reminder.error).toBeNull();
    expect(reminder.data!.reminder_sent_at).not.toBeNull();

    const outboxRows = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientCompanyId, grower.companyId));
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({
      templateKey: "pick_reminder",
      recipientType: "grower",
      tradingDayId: day.id,
    });

    await backoffice.from("daily_picks").update({ status: "closed" }).eq("id", pickId);
    const afterClose = await backoffice.rpc(
      "send_pick_reminder",
      toSendPickReminderRpcArgs({ dailyPickId: pickId }),
    );
    expect(afterClose.error).not.toBeNull();
    expect(afterClose.error?.code).toBe(GROWER_ERROR_CODES.INVALID_STATE);
  }, 30000);

  // The regression this function exists for. The editor used to save by firing
  // one RPC per changed line, each its own transaction, so a rejection on ONE
  // line still committed every other line — the grower saw an error over a
  // table that had been partly written. Two lines, the second guaranteed to be
  // rejected by the arrangement floor, is the smallest case that tells the two
  // behaviours apart.
  it("save_pick_lines applies every line or none: one rejected line rolls back the whole save", async () => {
    const { client: backoffice, userId: adminId } = await signedInBackoffice();
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const secondProduct = await addGrowerProduct(grower.companyId);
    cleanupFns.push(() => removeGrowerProduct(grower.companyId, secondProduct.varietyId));
    cleanupFns.push(() => deleteTestProductVariety(secondProduct));

    const { day, arrangement } = await createClosedTestDay(adminId);
    const customer = await createTestCompany("Test Customer", "customer");
    cleanupFns.push(() => deleteTestCompany(customer.id));
    // Pushed after every fixture the day's cascade could collide with — see
    // createClosedTestDay's comment on LIFO ordering.
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const bootstrap = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    const pickId = bootstrap.data!.id;
    const lineA = await getPickProductLine(pickId, grower.varietyId);
    const lineB = await getPickProductLine(pickId, secondProduct.varietyId);

    const growerClient = await signedInGrowerFor(grower.companyId);

    // Both lines start at 10 picked, and 6 pallets of line B are already
    // arranged to a customer — so line B can never drop below 6.
    const seed = await growerClient.rpc(
      "save_pick_lines",
      toSavePickLinesRpcArgs({
        dailyPickId: pickId,
        lines: [
          { dailyPickProductId: lineA!.id, palletsPicked: 10, leftoverPallets: 0, comment: null },
          { dailyPickProductId: lineB!.id, palletsPicked: 10, leftoverPallets: 0, comment: null },
        ],
      }),
    );
    expect(seed.error).toBeNull();

    const orderLine = await createTestOrderProductLine(day.id, customer.id, secondProduct.varietyId, 6);
    await createTestArrangementRecord({
      dailyArrangementId: arrangement.id,
      dailyPickProductId: lineB!.id,
      dailyOrderProductId: orderLine.id,
      customerCompanyId: customer.id,
      quantityPallets: 6,
    });

    // Line A is a perfectly valid edit; line B breaches the floor. Under the
    // old fan-out, A committed and B failed.
    const rejected = await growerClient.rpc(
      "save_pick_lines",
      toSavePickLinesRpcArgs({
        dailyPickId: pickId,
        lines: [
          {
            dailyPickProductId: lineA!.id,
            palletsPicked: 99,
            leftoverPallets: 0,
            comment: "changed",
          },
          { dailyPickProductId: lineB!.id, palletsPicked: 1, leftoverPallets: 0, comment: null },
        ],
      }),
    );
    expect(rejected.error).not.toBeNull();
    expect(rejected.error?.code).toBe(GROWER_ERROR_CODES.CONFLICT);

    // The assertion that matters: line A must be untouched, not 99.
    const afterA = await getPickProductLine(pickId, grower.varietyId);
    expect(afterA).toMatchObject({ palletsPicked: "10.00", comment: null });
    const afterB = await getPickProductLine(pickId, secondProduct.varietyId);
    expect(afterB).toMatchObject({ palletsPicked: "10.00" });

    // And a save where every line is valid still applies in full.
    const accepted = await growerClient.rpc(
      "save_pick_lines",
      toSavePickLinesRpcArgs({
        dailyPickId: pickId,
        lines: [
          {
            dailyPickProductId: lineA!.id,
            palletsPicked: 99,
            leftoverPallets: 0,
            comment: "changed",
          },
          { dailyPickProductId: lineB!.id, palletsPicked: 7, leftoverPallets: 0, comment: null },
        ],
      }),
    );
    expect(accepted.error).toBeNull();
    expect(await getPickProductLine(pickId, grower.varietyId)).toMatchObject({
      palletsPicked: "99.00",
      comment: "changed",
    });
    expect(await getPickProductLine(pickId, secondProduct.varietyId)).toMatchObject({
      palletsPicked: "7.00",
    });
  }, 30000);

  it("save_pick_lines' arrangement floor is on picked + leftover COMBINED, not either field alone", async () => {
    const { client: backoffice, userId: adminId } = await signedInBackoffice();
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const { day, arrangement } = await createClosedTestDay(adminId);
    const customer = await createTestCompany("Test Customer", "customer");
    cleanupFns.push(() => deleteTestCompany(customer.id));
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const bootstrap = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: grower.companyId }),
    );
    const pickId = bootstrap.data!.id;
    const line = await getPickProductLine(pickId, grower.varietyId);

    const growerClient = await signedInGrowerFor(grower.companyId);

    // Seed 4 picked + 6 leftover = 10 combined.
    const seed = await growerClient.rpc(
      "save_pick_lines",
      toSavePickLinesRpcArgs({
        dailyPickId: pickId,
        lines: [
          { dailyPickProductId: line!.id, palletsPicked: 4, leftoverPallets: 6, comment: null },
        ],
      }),
    );
    expect(seed.error).toBeNull();

    // 6 of the 10 combined pallets get arranged to a customer — the floor is
    // now 6, regardless of how it's split between the two fields.
    const orderLine = await createTestOrderProductLine(day.id, customer.id, grower.varietyId, 6);
    await createTestArrangementRecord({
      dailyArrangementId: arrangement.id,
      dailyPickProductId: line!.id,
      dailyOrderProductId: orderLine.id,
      customerCompanyId: customer.id,
      quantityPallets: 6,
    });

    // 3 picked + 2 leftover = 5 combined, below the 6-pallet floor: rejected,
    // even though palletsPicked alone (3) is well above what 3 < 4 might
    // suggest — the check is on the sum.
    const rejected = await growerClient.rpc(
      "save_pick_lines",
      toSavePickLinesRpcArgs({
        dailyPickId: pickId,
        lines: [
          { dailyPickProductId: line!.id, palletsPicked: 3, leftoverPallets: 2, comment: null },
        ],
      }),
    );
    expect(rejected.error).not.toBeNull();
    expect(rejected.error?.code).toBe(GROWER_ERROR_CODES.CONFLICT);
    expect(await getPickProductLine(pickId, grower.varietyId)).toMatchObject({
      palletsPicked: "4.00",
      leftoverPallets: "6.00",
    });

    // 3 picked + 3 leftover = 6 combined, exactly at the floor: a grower may
    // freely shift quantity between the two fields (here, moving 1 pallet
    // from picked into leftover) as long as the sum holds.
    const atFloor = await growerClient.rpc(
      "save_pick_lines",
      toSavePickLinesRpcArgs({
        dailyPickId: pickId,
        lines: [
          { dailyPickProductId: line!.id, palletsPicked: 3, leftoverPallets: 3, comment: null },
        ],
      }),
    );
    expect(atFloor.error).toBeNull();
    expect(await getPickProductLine(pickId, grower.varietyId)).toMatchObject({
      palletsPicked: "3.00",
      leftoverPallets: "3.00",
    });

    // Zeroing out leftover entirely (e.g. it went bad) succeeds as long as
    // picked alone still covers what's arranged.
    const zeroedLeftover = await growerClient.rpc(
      "save_pick_lines",
      toSavePickLinesRpcArgs({
        dailyPickId: pickId,
        lines: [
          { dailyPickProductId: line!.id, palletsPicked: 6, leftoverPallets: 0, comment: null },
        ],
      }),
    );
    expect(zeroedLeftover.error).toBeNull();
    expect(await getPickProductLine(pickId, grower.varietyId)).toMatchObject({
      palletsPicked: "6.00",
      leftoverPallets: "0.00",
    });
  }, 30000);

  // A batch takes a list of line ids, which the per-line functions never had
  // to cross-check against the pick they belong to. Authorizing the pick alone
  // would let a grower pair their own pick id with someone else's line ids.
  it("save_pick_lines rejects a line id belonging to a different pick", async () => {
    const { client: backoffice, userId: adminId } = await signedInBackoffice();
    const growerOne = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(growerOne));
    const growerTwo = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(growerTwo));
    const { day } = await createClosedTestDay(adminId);
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const pickOne = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: growerOne.companyId }),
    );
    const pickTwo = await backoffice.rpc(
      "bootstrap_grower_pick",
      toBootstrapGrowerPickRpcArgs({ tradingDayId: day.id, growerCompanyId: growerTwo.companyId }),
    );
    const lineOne = await getPickProductLine(pickOne.data!.id, growerOne.varietyId);
    const lineTwo = await getPickProductLine(pickTwo.data!.id, growerTwo.varietyId);

    const growerOneClient = await signedInGrowerFor(growerOne.companyId);
    const crossed = await growerOneClient.rpc(
      "save_pick_lines",
      toSavePickLinesRpcArgs({
        // Grower one's own pick — authorized — but carrying grower two's line.
        dailyPickId: pickOne.data!.id,
        lines: [
          { dailyPickProductId: lineOne!.id, palletsPicked: 5, leftoverPallets: 0, comment: null },
          { dailyPickProductId: lineTwo!.id, palletsPicked: 5, leftoverPallets: 0, comment: null },
        ],
      }),
    );
    expect(crossed.error).not.toBeNull();
    expect(crossed.error?.code).toBe(GROWER_ERROR_CODES.FORBIDDEN);

    // Rolled back whole, so grower one's own line is unchanged too.
    expect(await getPickProductLine(pickOne.data!.id, growerOne.varietyId)).toMatchObject({
      palletsPicked: "0.00",
    });
    expect(await getPickProductLine(pickTwo.data!.id, growerTwo.varietyId)).toMatchObject({
      palletsPicked: "0.00",
    });
  }, 30000);
});
