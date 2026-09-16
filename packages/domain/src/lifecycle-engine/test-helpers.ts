import { randomUUID } from "node:crypto";

import { db } from "@ori/db";
import {
  arrangementRecords,
  companies,
  dailyOrderProducts,
  dailyOrders,
  dailyPickProducts,
  dailyPicks,
  growerProducts,
  productFamilies,
  productVarieties,
  tradingDays,
} from "@ori/db/schema";
import { and, eq } from "drizzle-orm";

// Test-only fixtures for the lifecycle-engine module — mirrors
// packages/domain/src/reference-data/test-helpers.ts (not part of the
// package's public exports; see package.json). Company/profile/sign-in
// fixtures live in ../auth/test-helpers and are reused directly.

// Re-exported so both suites reach these through the one `/testing` subpath
// they already import from — apps/web's Playwright global hooks have no
// other route into this package.
export { parkOpenTradingDay, restoreParkedTradingDay } from "./trading-day-slot";

export interface TestGrowerWithProduct {
  companyId: string;
  familyId: string;
  varietyId: string;
  // The generated names, returned alongside the ids because the UI addresses
  // all three by name — a grower card, a catalog family row, a variety line.
  // Every e2e spec that drives those screens had to re-query them out of
  // Postgres to find its own fixture on a page that now also lists the seeded
  // demo data; handing them back here is cheaper than three lookups, and
  // keeps apps/web from needing a drizzle dependency just to read a name.
  companyName: string;
  familyName: string;
  varietyName: string;
}

export interface CreateTestGrowerWithProductOptions {
  // Catalog price for the generated variety. Defaults to null — priceless,
  // which is what every caller that never closes a day wants.
  //
  // A test that drives close_arrangement needs one, though: that function
  // refuses to close a day holding an arrangement record whose variety has
  // neither a price nor a price range (populate_arrangement_prices, 0022 —
  // "a real data problem, not something to silently leave null"). Allocating
  // off a priceless product and then closing the day is therefore a state
  // the application deliberately rejects, not something to work around.
  price?: number;
  // The grower company's default collection time — what submit_pick and
  // close_arrangement snapshot onto daily_picks.pickup_time (0043). Defaults
  // to null, which is fine for callers that don't exercise that snapshot.
  defaultPickupTime?: string;
}

// A grower with exactly one in-season product — the minimum shape
// initiate_business_day's eligibility filter (active grower, non-empty
// grower_products) needs to actually bootstrap a Daily Pick.
export async function createTestGrowerWithProduct(
  options: CreateTestGrowerWithProductOptions = {},
): Promise<TestGrowerWithProduct> {
  const [company] = await db
    .insert(companies)
    .values({
      name: `מגדל בדיקה ${randomUUID()}`,
      type: "grower",
      ...(options.defaultPickupTime === undefined ? {} : { defaultPickupTime: options.defaultPickupTime }),
    })
    .returning();
  if (!company) throw new Error("failed to create test grower company");

  const [family] = await db
    .insert(productFamilies)
    .values({ name: `משפחת בדיקה ${randomUUID()}` })
    .returning();
  if (!family) throw new Error("failed to create test product family");

  const [variety] = await db
    .insert(productVarieties)
    .values({
      familyId: family.id,
      name: `זן בדיקה ${randomUUID()}`,
      ...(options.price === undefined ? {} : { price: options.price.toString() }),
    })
    .returning();
  if (!variety) throw new Error("failed to create test product variety");

  await db.insert(growerProducts).values({ companyId: company.id, productVarietyId: variety.id });

  return {
    companyId: company.id,
    familyId: family.id,
    varietyId: variety.id,
    companyName: company.name,
    familyName: family.name,
    varietyName: variety.name,
  };
}

// Cascades: deleting the company does NOT cascade to product_families /
// product_varieties (those aren't owned by the company), so each is
// cleaned up explicitly, company last (grower_products references it).
export async function deleteTestGrowerWithProduct(fixture: TestGrowerWithProduct): Promise<void> {
  await db.delete(productVarieties).where(eq(productVarieties.id, fixture.varietyId));
  await db.delete(productFamilies).where(eq(productFamilies.id, fixture.familyId));
  await db.delete(companies).where(eq(companies.id, fixture.companyId));
}

export interface CreateTestTradingDayOptions {
  tradeDate?: string;
  phase?: "initiated" | "shop_open" | "shop_closed" | "closed";
  initiatedByUserId: string;
}

// Direct-insert fixture for tests that need a trading day already sitting
// in a specific phase (e.g. asserting close_shop rejects a day that's
// still just "initiated") without walking the full RPC chain to get
// there. Bypasses the concurrency-guard partial unique index the same way
// any trusted-connection write does — callers are responsible for not
// creating two non-closed days at once if a test cares about that.
export async function createTestTradingDay(options: CreateTestTradingDayOptions) {
  const [day] = await db
    .insert(tradingDays)
    .values({
      tradeDate: options.tradeDate ?? new Date().toISOString().slice(0, 10),
      phase: options.phase ?? "initiated",
      initiatedBy: options.initiatedByUserId,
    })
    .returning();
  if (!day) throw new Error("failed to create test trading day");
  return day;
}

// Cascades to daily_shops/daily_arrangements/daily_picks/daily_orders/
// lifecycle_sessions and (transitively) daily_pick_products/
// arrangement_records — see 0012_lifecycle-cascade-deletes.sql.
export async function deleteTestTradingDay(tradingDayId: string): Promise<void> {
  await db.delete(tradingDays).where(eq(tradingDays.id, tradingDayId));
}

export async function getDailyPickForGrower(tradingDayId: string, growerCompanyId: string) {
  const [pick] = await db
    .select()
    .from(dailyPicks)
    .where(and(eq(dailyPicks.tradingDayId, tradingDayId), eq(dailyPicks.growerCompanyId, growerCompanyId)));
  return pick ?? null;
}

export async function getPickProductLine(dailyPickId: string, productVarietyId: string) {
  const rows = await db.select().from(dailyPickProducts).where(eq(dailyPickProducts.dailyPickId, dailyPickId));
  return rows.find((row) => row.productVarietyId === productVarietyId) ?? null;
}

// Direct-insert fixture for a customer's order line — arrangement_records
// pairs a pick line with a *specific order line*, not just a customer
// company (see docs/SCHEMA_DECISIONS.md), so any test that needs an
// arrangement record needs one of these first. Creates the customer's
// daily_orders header too, since a bare order-product line can't exist
// without its parent.
export async function createTestOrderProductLine(
  tradingDayId: string,
  customerCompanyId: string,
  productVarietyId: string,
  palletsOrdered: number,
) {
  const [order] = await db
    .insert(dailyOrders)
    .values({ tradingDayId, customerCompanyId })
    .onConflictDoNothing()
    .returning();
  const orderId =
    order?.id ??
    (
      await db
        .select({ id: dailyOrders.id })
        .from(dailyOrders)
        .where(and(eq(dailyOrders.tradingDayId, tradingDayId), eq(dailyOrders.customerCompanyId, customerCompanyId)))
    )[0]?.id;
  if (!orderId) throw new Error("failed to create or find test daily order");

  const [line] = await db
    .insert(dailyOrderProducts)
    .values({ dailyOrderId: orderId, productVarietyId, palletsOrdered: palletsOrdered.toString() })
    .returning();
  if (!line) throw new Error("failed to create test order product line");
  return line;
}

export interface CreateTestArrangementRecordOptions {
  dailyArrangementId: string;
  dailyPickProductId: string;
  dailyOrderProductId: string;
  customerCompanyId: string;
  quantityPallets: number;
}

// Direct-insert fixture standing in for the New Arrangement backend
// (packages/db/migrations for create_arrangement_record) — this module
// only needs a real arrangement_records row to exist for the
// arrangement-edit floor check to have something to sum against.
export async function createTestArrangementRecord(options: CreateTestArrangementRecordOptions) {
  const [record] = await db
    .insert(arrangementRecords)
    .values({
      dailyArrangementId: options.dailyArrangementId,
      dailyPickProductId: options.dailyPickProductId,
      dailyOrderProductId: options.dailyOrderProductId,
      customerCompanyId: options.customerCompanyId,
      quantityPallets: options.quantityPallets.toString(),
    })
    .returning();
  if (!record) throw new Error("failed to create test arrangement record");
  return record;
}
