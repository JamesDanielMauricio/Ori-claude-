import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createTestCompany, createTestProfile, deleteTestCompany, deleteTestUser, runCleanup, signInTestUser } from "../auth/test-helpers";

import { PRODUCT_VERSION_CONFLICT_ERROR_CODE, toSaveGrowerRpcArgs, toSaveProductRpcArgs } from "./schemas";
import {
  createTestGrowerCompany,
  createTestProductFamily,
  createTestProductVariety,
  deleteTestCompany as deleteTestCompanyById,
  deleteTestProductFamily,
  deleteTestProductVariety,
} from "./test-helpers";

// These exercise the `save_*` Postgres functions (R4/R7 — see
// packages/db/migrations/0007_reference-data-functions.sql) through the
// real anon-key + signed-in-JWT path, never the service-role client, so
// RLS applies exactly as it would from apps/web. Two failure modes are the
// specific point of this suite — the two the source app was documented to
// have:
//
// 1. A concurrent edit silently overwriting someone else's change
//    (no conflict detection at all in the source).
// 2. A multi-step save leaving partial state when it fails partway
//    (no transactional boundary at all in the source).
//
// Both are now structurally impossible rather than "less likely" — see the
// migration's own comment for why a function call is one transaction.
describe("reference-data save functions", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  async function signedInBackofficeClient() {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    return signInTestUser(admin.email, admin.password);
  }

  it("save_product: a concurrent writer with a stale version is rejected, not silently merged", async () => {
    const family = await createTestProductFamily();
    cleanupFns.push(() => deleteTestProductFamily(family.id));
    const product = await createTestProductVariety({ familyId: family.id });
    cleanupFns.push(() => deleteTestProductVariety(product.id));

    const client = await signedInBackofficeClient();

    const firstWriter = await client.rpc(
      "save_product",
      toSaveProductRpcArgs({
        id: product.id,
        familyId: family.id,
        name: "Written by first writer",
        sizes: null,
        packType: null,
        price: null,
        priceRangeFrom: null,
        priceRangeTo: null,
        priceType: null,
        noOverbooking: 0,
        highlightPriceFluctuations: false,
        isSeasonalAvailable: true,
        numberOfOrdersPerCustomer: null,
        expectedVersion: 1,
        customerPalletCaps: [],
      }),
    );
    expect(firstWriter.error).toBeNull();
    expect(firstWriter.data).toMatchObject({ name: "Written by first writer", version: 2 });

    // Second writer read the row before the first writer's save landed —
    // still holds the now-stale version 1.
    const secondWriter = await client.rpc(
      "save_product",
      toSaveProductRpcArgs({
        id: product.id,
        familyId: family.id,
        name: "Written by second writer",
        sizes: null,
        packType: null,
        price: null,
        priceRangeFrom: null,
        priceRangeTo: null,
        priceType: null,
        noOverbooking: 0,
        highlightPriceFluctuations: false,
        isSeasonalAvailable: true,
        numberOfOrdersPerCustomer: null,
        expectedVersion: 1,
        customerPalletCaps: [],
      }),
    );

    expect(secondWriter.error).not.toBeNull();
    expect(secondWriter.error?.code).toBe(PRODUCT_VERSION_CONFLICT_ERROR_CODE);

    // The first writer's change is intact — not overwritten, not merged.
    const { data: current } = await client
      .from("product_varieties")
      .select("name, version")
      .eq("id", product.id)
      .single();
    expect(current).toMatchObject({ name: "Written by first writer", version: 2 });
  });

  it("save_grower: a save that fails partway leaves no partial state behind", async () => {
    const client = await signedInBackofficeClient();
    const growerName = `Partial-failure probe ${randomUUID()}`;

    // A product variety id that doesn't exist violates grower_products'
    // foreign key — this must fail the *whole* call, including the
    // companies insert that already ran earlier in the same function.
    const result = await client.rpc(
      "save_grower",
      toSaveGrowerRpcArgs({
        id: null,
        name: growerName,
        status: "active",
        defaultPickupTime: null,
        whatsappGroupId: null,
        productVarietyIds: [randomUUID()],
        transporterCompanyId: null,
      }),
    );

    expect(result.error).not.toBeNull();

    // If the source app's bug had reproduced, this would find a
    // half-created company (row exists, product selection doesn't). It
    // must find nothing at all.
    const { data: leftover } = await client.from("companies").select("id").eq("name", growerName);
    expect(leftover).toEqual([]);
  });

  it("save_grower: happy path creates the company and its product selection together", async () => {
    const family = await createTestProductFamily();
    cleanupFns.push(() => deleteTestProductFamily(family.id));
    const product = await createTestProductVariety({ familyId: family.id });
    cleanupFns.push(() => deleteTestProductVariety(product.id));

    const client = await signedInBackofficeClient();
    const growerName = `Happy-path grower ${randomUUID()}`;

    const result = await client.rpc(
      "save_grower",
      toSaveGrowerRpcArgs({
        id: null,
        name: growerName,
        status: "active",
        defaultPickupTime: null,
        whatsappGroupId: null,
        productVarietyIds: [product.id],
        transporterCompanyId: null,
      }),
    );
    expect(result.error).toBeNull();
    const createdId = (result.data as { id: string } | null)?.id;
    expect(createdId).toBeTruthy();
    if (createdId) cleanupFns.push(() => deleteTestCompanyById(createdId));

    const { data: selection } = await client
      .from("grower_products")
      .select("product_variety_id")
      .eq("company_id", createdId!);
    expect(selection).toEqual([{ product_variety_id: product.id }]);
  });

  it("save_grower: assigns a transporter (id 8's cc target), and rejects a non-transporter company id", async () => {
    const client = await signedInBackofficeClient();
    const transporter = await createTestCompany(`Test Transporter ${randomUUID()}`, "transporter");
    cleanupFns.push(() => deleteTestCompany(transporter.id));
    const growerName = `Transporter-assignment grower ${randomUUID()}`;

    const created = await client.rpc(
      "save_grower",
      toSaveGrowerRpcArgs({
        id: null,
        name: growerName,
        status: "active",
        defaultPickupTime: null,
        whatsappGroupId: null,
        productVarietyIds: [],
        transporterCompanyId: transporter.id,
      }),
    );
    expect(created.error).toBeNull();
    const createdId = (created.data as { id: string; transporter_company_id: string | null } | null)?.id;
    expect(createdId).toBeTruthy();
    if (createdId) cleanupFns.push(() => deleteTestCompanyById(createdId));
    expect((created.data as { transporter_company_id: string | null }).transporter_company_id).toBe(transporter.id);

    // A grower company id (or any non-transporter type) is rejected, not
    // silently accepted — the whole point of validating the type inside
    // save_grower rather than trusting the client.
    const rejected = await client.rpc(
      "save_grower",
      toSaveGrowerRpcArgs({
        id: createdId!,
        name: growerName,
        status: "active",
        defaultPickupTime: null,
        whatsappGroupId: null,
        productVarietyIds: [],
        transporterCompanyId: createdId!,
      }),
    );
    expect(rejected.error).not.toBeNull();
    expect(rejected.error?.code).toBe("P0008");
  });

  it("save_product: rejects a non-backoffice caller with a clear error, not a silent no-op", async () => {
    const family = await createTestProductFamily();
    cleanupFns.push(() => deleteTestProductFamily(family.id));
    const product = await createTestProductVariety({ familyId: family.id });
    cleanupFns.push(() => deleteTestProductVariety(product.id));

    const growerCompany = await createTestGrowerCompany();
    cleanupFns.push(() => deleteTestCompanyById(growerCompany.id));
    const grower = await createTestProfile({ companyId: growerCompany.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(grower.userId));
    const growerClient = await signInTestUser(grower.email, grower.password);

    const result = await growerClient.rpc(
      "save_product",
      toSaveProductRpcArgs({
        id: product.id,
        familyId: family.id,
        name: "Hijacked by a grower",
        sizes: null,
        packType: null,
        price: null,
        priceRangeFrom: null,
        priceRangeTo: null,
        priceType: null,
        noOverbooking: 0,
        highlightPriceFluctuations: false,
        isSeasonalAvailable: true,
        numberOfOrdersPerCustomer: null,
        expectedVersion: 1,
        customerPalletCaps: [],
      }),
    );

    expect(result.error).not.toBeNull();
    expect(result.error?.message).toMatch(/FORBIDDEN/);

    const { data: unchanged } = await growerClient
      .from("product_varieties")
      .select("name, version")
      .eq("id", product.id)
      .single();
    expect(unchanged).toMatchObject({ name: product.name, version: 1 });
  });
});
