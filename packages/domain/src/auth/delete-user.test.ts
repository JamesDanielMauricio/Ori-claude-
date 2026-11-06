import { randomUUID } from "node:crypto";

import { db } from "@ori/db";
import {
  dailyShops,
  lifecycleSessions,
  orderSubmissionLogs,
  profiles,
  tradingDays,
} from "@ori/db/schema";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createTestDailyOrder, createTestDailyShop } from "../customer/test-helpers";
import { createTestTradingDay, deleteTestTradingDay } from "../lifecycle-engine/test-helpers";

import { deleteUser } from "./delete-user";
import { createServiceRoleClient } from "./supabase-clients";
import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
} from "./test-helpers";

// The Users screen's delete, through the real Supabase Admin API. Four
// history tables name the person who did something; until migration 0073
// they refused the delete of anyone they named, so a user who had ever sent
// an order or run a trading day could not be removed at all. James chose
// Bubble's behaviour: the user goes, and the history stays without their name.
describe("deleteUser", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  it("deletes a user who has history — everything they did stays, with their name left empty (migration 0073)", async () => {
    const company = await createTestCompany(`לקוח בדיקה ${randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(company.id));
    const user = await createTestProfile({ companyId: company.id, role: "customer" });
    // The test deletes this user itself; this only cleans up if it never got
    // that far.
    cleanupFns.push(async () => {
      const { data } = await createServiceRoleClient().auth.admin.getUserById(user.userId);
      if (data.user) await deleteTestUser(user.userId);
    });

    // History in all four places that name a person: a day they started,
    // its shop they opened, a day action they performed, an order they sent.
    const day = await createTestTradingDay({ initiatedByUserId: user.userId, phase: "closed" });
    cleanupFns.push(() => deleteTestTradingDay(day.id));
    const shop = await createTestDailyShop({ tradingDayId: day.id, openedByUserId: user.userId });
    const [session] = await db
      .insert(lifecycleSessions)
      .values({ tradingDayId: day.id, sessionType: "close_shop", performedBy: user.userId })
      .returning();
    const order = await createTestDailyOrder({
      tradingDayId: day.id,
      customerCompanyId: company.id,
    });
    const [log] = await db
      .insert(orderSubmissionLogs)
      .values({ dailyOrderId: order.id, submittedBy: user.userId, snapshot: [] })
      .returning();

    await deleteUser({ targetUserId: user.userId });

    // The user is gone — login and profile...
    const { data } = await createServiceRoleClient().auth.admin.getUserById(user.userId);
    expect(data.user).toBeNull();
    expect(await db.select().from(profiles).where(eq(profiles.userId, user.userId))).toHaveLength(
      0,
    );

    // ...and everything they did is still there, without their name.
    const [dayAfter] = await db.select().from(tradingDays).where(eq(tradingDays.id, day.id));
    expect(dayAfter).toMatchObject({ initiatedBy: null, tradeDate: day.tradeDate });
    const [shopAfter] = await db.select().from(dailyShops).where(eq(dailyShops.id, shop.id));
    expect(shopAfter).toMatchObject({ openedBy: null });
    const [sessionAfter] = await db
      .select()
      .from(lifecycleSessions)
      .where(eq(lifecycleSessions.id, session!.id));
    expect(sessionAfter).toMatchObject({ performedBy: null, sessionType: "close_shop" });
    const [logAfter] = await db
      .select()
      .from(orderSubmissionLogs)
      .where(eq(orderSubmissionLogs.id, log!.id));
    expect(logAfter).toMatchObject({ submittedBy: null, dailyOrderId: order.id });
  }, 30000);
});
