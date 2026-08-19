import { randomUUID } from "node:crypto";

import { db } from "@ori/db";
import { growerProducts, productFamilies, productVarieties } from "@ori/db/schema";
import { and, eq } from "drizzle-orm";

// Test-only fixtures for the grower module — mirrors
// packages/domain/src/lifecycle-engine/test-helpers.ts (not part of the
// package's public exports; see package.json). Company/profile/sign-in
// fixtures live in ../auth/test-helpers, and the grower-with-one-product +
// trading-day fixtures live in ../lifecycle-engine/test-helpers — both are
// reused directly rather than duplicated here.

export interface TestProductVariety {
  familyId: string;
  varietyId: string;
}

// A second in-season product added to an existing grower — for proving a
// second call to bootstrap_grower_pick reacts to an in-season-list change
// (adds a new line) without disturbing a line that already exists.
export async function addGrowerProduct(companyId: string): Promise<TestProductVariety> {
  const [family] = await db
    .insert(productFamilies)
    .values({ name: `Test Family ${randomUUID()}` })
    .returning();
  if (!family) throw new Error("failed to create test product family");

  const [variety] = await db
    .insert(productVarieties)
    .values({ familyId: family.id, name: `Test Variety ${randomUUID()}` })
    .returning();
  if (!variety) throw new Error("failed to create test product variety");

  await db.insert(growerProducts).values({ companyId, productVarietyId: variety.id });

  return { familyId: family.id, varietyId: variety.id };
}

// Drops a product from the grower's in-season list without touching the
// catalog row itself — the natural-key state bootstrap_grower_pick's
// prune step reacts to.
export async function removeGrowerProduct(companyId: string, varietyId: string): Promise<void> {
  await db
    .delete(growerProducts)
    .where(and(eq(growerProducts.companyId, companyId), eq(growerProducts.productVarietyId, varietyId)));
}

export async function deleteTestProductVariety(fixture: TestProductVariety): Promise<void> {
  await db.delete(productVarieties).where(eq(productVarieties.id, fixture.varietyId));
  await db.delete(productFamilies).where(eq(productFamilies.id, fixture.familyId));
}
