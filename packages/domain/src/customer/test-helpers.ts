import { db } from "@ori/db";
import { dailyOrderProducts, dailyOrders, dailyShops } from "@ori/db/schema";
import { and, eq } from "drizzle-orm";

// Test-only fixtures for the customer module — mirrors
// packages/domain/src/grower/test-helpers.ts (not part of the package's
// public exports; see package.json). Company/profile/sign-in fixtures live
// in ../auth/test-helpers; trading-day and grower-with-one-product
// fixtures live in ../lifecycle-engine/test-helpers — all reused directly
// rather than duplicated here.

export interface CreateTestDailyShopOptions {
  tradingDayId: string;
  openedByUserId: string;
  canSeePrices?: boolean;
}

// Direct-insert fixture standing in for `open_shop` — this module's tests
// need a real daily_shops row to exist (get_orderable_catalog_for_customer
// inner-joins it) without walking the full lifecycle RPC chain to get
// there.
export async function createTestDailyShop(options: CreateTestDailyShopOptions) {
  const [shop] = await db
    .insert(dailyShops)
    .values({
      tradingDayId: options.tradingDayId,
      openedBy: options.openedByUserId,
      canSeePrices: options.canSeePrices ?? true,
    })
    .returning();
  if (!shop) throw new Error("failed to create test daily shop");
  return shop;
}

export interface CreateTestDailyOrderOptions {
  tradingDayId: string;
  customerCompanyId: string;
}

// Direct-insert fixture standing in for open_shop's customer-order
// bootstrap.
export async function createTestDailyOrder(options: CreateTestDailyOrderOptions) {
  const [order] = await db
    .insert(dailyOrders)
    .values({ tradingDayId: options.tradingDayId, customerCompanyId: options.customerCompanyId })
    .returning();
  if (!order) throw new Error("failed to create test daily order");
  return order;
}

export async function getDailyOrderForCustomer(tradingDayId: string, customerCompanyId: string) {
  const [order] = await db
    .select()
    .from(dailyOrders)
    .where(and(eq(dailyOrders.tradingDayId, tradingDayId), eq(dailyOrders.customerCompanyId, customerCompanyId)));
  return order ?? null;
}

export async function getOrderProductLine(dailyOrderId: string, productVarietyId: string) {
  const rows = await db.select().from(dailyOrderProducts).where(eq(dailyOrderProducts.dailyOrderId, dailyOrderId));
  return rows.find((row) => row.productVarietyId === productVarietyId) ?? null;
}
