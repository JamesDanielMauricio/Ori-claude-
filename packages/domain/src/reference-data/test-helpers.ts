import { randomUUID } from "node:crypto";

import { db } from "@ori/db";
import { companies, productFamilies, productVarieties } from "@ori/db/schema";
import { eq } from "drizzle-orm";

// Test-only fixtures for the reference-data module — mirrors
// packages/domain/src/auth/test-helpers.ts (not part of the package's
// public exports; see package.json). Company/user/sign-in fixtures
// (createTestCompany, createTestProfile, signInTestUser, runCleanup) live
// there already and are reused directly rather than duplicated here.

export async function createTestGrowerCompany(name = `Test Grower ${randomUUID()}`) {
  const [company] = await db.insert(companies).values({ name, type: "grower" }).returning();
  if (!company) throw new Error("failed to create test grower company");
  return company;
}

export async function createTestCustomerCompany(name = `Test Customer ${randomUUID()}`) {
  const [company] = await db.insert(companies).values({ name, type: "customer" }).returning();
  if (!company) throw new Error("failed to create test customer company");
  return company;
}

export async function createTestTransporterCompany(name = `Test Transporter ${randomUUID()}`) {
  const [company] = await db.insert(companies).values({ name, type: "transporter" }).returning();
  if (!company) throw new Error("failed to create test transporter company");
  return company;
}

export async function deleteTestCompany(companyId: string): Promise<void> {
  await db.delete(companies).where(eq(companies.id, companyId));
}

export async function createTestProductFamily(name = `Test Family ${randomUUID()}`) {
  const [family] = await db.insert(productFamilies).values({ name }).returning();
  if (!family) throw new Error("failed to create test product family");
  return family;
}

export async function deleteTestProductFamily(familyId: string): Promise<void> {
  await db.delete(productFamilies).where(eq(productFamilies.id, familyId));
}

export interface CreateTestProductVarietyOptions {
  familyId: string;
  name?: string;
  version?: number;
}

export async function createTestProductVariety(options: CreateTestProductVarietyOptions) {
  const [variety] = await db
    .insert(productVarieties)
    .values({
      familyId: options.familyId,
      name: options.name ?? `Test Variety ${randomUUID()}`,
      version: options.version ?? 1,
    })
    .returning();
  if (!variety) throw new Error("failed to create test product variety");
  return variety;
}

export async function deleteTestProductVariety(productVarietyId: string): Promise<void> {
  await db.delete(productVarieties).where(eq(productVarieties.id, productVarietyId));
}

// e2e-only lookups: a Playwright spec creates a row through the real UI
// (it doesn't get the row back as a JS value the way an API call would),
// so cleanup needs to resolve the id from the unique name the test itself
// generated and typed into the form.
export async function findCompanyIdByName(name: string): Promise<string | null> {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.name, name))
    .limit(1);
  return row?.id ?? null;
}

export async function findProductFamilyIdByName(name: string): Promise<string | null> {
  const [row] = await db
    .select({ id: productFamilies.id })
    .from(productFamilies)
    .where(eq(productFamilies.name, name))
    .limit(1);
  return row?.id ?? null;
}

export async function findProductVarietyIdByName(name: string): Promise<string | null> {
  const [row] = await db
    .select({ id: productVarieties.id })
    .from(productVarieties)
    .where(eq(productVarieties.name, name))
    .limit(1);
  return row?.id ?? null;
}
