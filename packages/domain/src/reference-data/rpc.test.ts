import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createTestCompany, createTestProfile, deleteTestCompany, deleteTestUser, runCleanup, signInTestUser } from "../auth/test-helpers";

import {
  PRODUCT_VERSION_CONFLICT_ERROR_CODE,
  toSaveCustomerRpcArgs,
  toSaveGrowerRpcArgs,
  toSaveProductRpcArgs,
  toSaveTransporterRpcArgs,
  toSetCustomerScoreRpcArgs,
} from "./schemas";
import {
  createTestCustomerCompany,
  createTestGrowerCompany,
  createTestProductFamily,
  createTestProductVariety,
  createTestTransporterCompany,
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
        name: "נכתב על ידי הכותב הראשון",
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
    expect(firstWriter.data).toMatchObject({ name: "נכתב על ידי הכותב הראשון", version: 2 });

    // Second writer read the row before the first writer's save landed —
    // still holds the now-stale version 1.
    const secondWriter = await client.rpc(
      "save_product",
      toSaveProductRpcArgs({
        id: product.id,
        familyId: family.id,
        name: "נכתב על ידי הכותב השני",
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
    expect(current).toMatchObject({ name: "נכתב על ידי הכותב הראשון", version: 2 });
  });

  it("save_grower: a save that fails partway leaves no partial state behind", async () => {
    const client = await signedInBackofficeClient();
    const growerName = `בדיקת כשל חלקי ${randomUUID()}`;

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
        contactPersonId: null,
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
    const growerName = `מגדל תקין ${randomUUID()}`;

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
        contactPersonId: null,
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
    const transporter = await createTestCompany(`מוביל בדיקה ${randomUUID()}`, "transporter");
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
        contactPersonId: null,
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
        contactPersonId: null,
      }),
    );
    expect(rejected.error).not.toBeNull();
    expect(rejected.error?.code).toBe("P0008");
  });

  it("save_grower/save_customer/save_transporter: contact_person_id is set across all three, and clears itself (not RESTRICT) when that user is deleted", async () => {
    const client = await signedInBackofficeClient();

    const contactCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(contactCompany.id));
    const contact = await createTestProfile({ companyId: contactCompany.id, role: "customer" });

    const grower = await createTestGrowerCompany();
    cleanupFns.push(() => deleteTestCompanyById(grower.id));
    const customer = await createTestCustomerCompany();
    cleanupFns.push(() => deleteTestCompanyById(customer.id));
    const transporter = await createTestTransporterCompany();
    cleanupFns.push(() => deleteTestCompanyById(transporter.id));

    const growerSaved = await client.rpc(
      "save_grower",
      toSaveGrowerRpcArgs({
        id: grower.id,
        name: grower.name,
        status: "active",
        defaultPickupTime: null,
        whatsappGroupId: null,
        productVarietyIds: [],
        transporterCompanyId: null,
        contactPersonId: contact.userId,
      }),
    );
    expect(growerSaved.error).toBeNull();
    expect((growerSaved.data as { contact_person_id: string | null } | null)?.contact_person_id).toBe(
      contact.userId,
    );

    const customerSaved = await client.rpc(
      "save_customer",
      toSaveCustomerRpcArgs({
        id: customer.id,
        name: customer.name,
        status: "active",
        canSeeProductPrices: null,
        whatsappGroupId: null,
        contactPersonId: contact.userId,
      }),
    );
    expect(customerSaved.error).toBeNull();
    expect((customerSaved.data as { contact_person_id: string | null } | null)?.contact_person_id).toBe(
      contact.userId,
    );

    const transporterSaved = await client.rpc(
      "save_transporter",
      toSaveTransporterRpcArgs({
        id: transporter.id,
        name: transporter.name,
        status: "active",
        whatsappGroupId: null,
        contactPersonId: contact.userId,
      }),
    );
    expect(transporterSaved.error).toBeNull();
    expect(
      (transporterSaved.data as { contact_person_id: string | null } | null)?.contact_person_id,
    ).toBe(contact.userId);

    // Deleting the contact's own account must not be blocked by any of
    // these references (unlike transporter_company_id, which is RESTRICT)
    // — each one should clear itself automatically instead.
    await deleteTestUser(contact.userId);

    const { data: rowsAfterDelete } = await client
      .from("companies")
      .select("id, contact_person_id")
      .in("id", [grower.id, customer.id, transporter.id]);
    for (const row of rowsAfterDelete ?? []) {
      expect(row.contact_person_id).toBeNull();
    }
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

  // set_customer_score (migration 0067). Who may NOT see or set a score is
  // rls.test.ts's business; this is what the function does for the one role
  // that may.
  it("set_customer_score: sets, overwrites and clears a customer's ranking score", async () => {
    const client = await signedInBackofficeClient();
    const customer = await createTestCustomerCompany();
    cleanupFns.push(() => deleteTestCompanyById(customer.id));

    const stored = async () => {
      const { data, error } = await client
        .from("customer_scores")
        .select("general_score")
        .eq("customer_company_id", customer.id);
      expect(error).toBeNull();
      return (data ?? []).map((row) => Number(row.general_score));
    };
    const set = (score: number | null) =>
      // Raw arguments, not the input schema: the schema rounds, and the first
      // call below is about what the COLUMN does with an unrounded number.
      client.rpc("set_customer_score", {
        p_customer_company_id: customer.id,
        p_general_score: score,
      });

    expect((await set(4.349999999999999)).error).toBeNull();
    expect(await stored()).toEqual([4.35]);

    expect((await set(3.5)).error).toBeNull();
    expect(await stored()).toEqual([3.5]);

    expect((await set(null)).error).toBeNull();
    expect(await stored()).toEqual([]);

    // Clearing a customer who has no score is not an error.
    expect((await set(null)).error).toBeNull();
    expect(await stored()).toEqual([]);
  });

  it("set_customer_score: refuses a score off the 1-to-5 scale, and a company that is not a customer", async () => {
    const client = await signedInBackofficeClient();
    const customer = await createTestCustomerCompany();
    cleanupFns.push(() => deleteTestCompanyById(customer.id));
    const grower = await createTestGrowerCompany();
    cleanupFns.push(() => deleteTestCompanyById(grower.id));

    for (const score of [0.99, 5.01, 0, -1]) {
      const refused = await client.rpc("set_customer_score", {
        p_customer_company_id: customer.id,
        p_general_score: score,
      });
      expect(refused.error?.code, `a score of ${score}`).toBe("P0008");
    }

    for (const companyId of [grower.id, randomUUID()]) {
      const refused = await client.rpc(
        "set_customer_score",
        toSetCustomerScoreRpcArgs({ customerCompanyId: companyId, generalScore: 3 }),
      );
      expect(refused.error?.code).toBe("P0002");
    }

    const stored = await client
      .from("customer_scores")
      .select("customer_company_id")
      .in("customer_company_id", [customer.id, grower.id]);
    expect(stored.data).toEqual([]);
  });

  it("set_customer_score: refuses a non-backoffice caller — the customer the score is about included", async () => {
    const adminClient = await signedInBackofficeClient();
    const customerCompany = await createTestCustomerCompany();
    cleanupFns.push(() => deleteTestCompanyById(customerCompany.id));
    const customer = await createTestProfile({ companyId: customerCompany.id, role: "customer" });
    cleanupFns.push(() => deleteTestUser(customer.userId));
    const customerClient = await signInTestUser(customer.email, customer.password);

    const seeded = await adminClient.rpc(
      "set_customer_score",
      toSetCustomerScoreRpcArgs({ customerCompanyId: customerCompany.id, generalScore: 2 }),
    );
    expect(seeded.error).toBeNull();

    const raised = await customerClient.rpc(
      "set_customer_score",
      toSetCustomerScoreRpcArgs({ customerCompanyId: customerCompany.id, generalScore: 5 }),
    );
    expect(raised.error?.code).toBe("42501");
    expect(raised.error?.message).toMatch(/FORBIDDEN/);

    const cleared = await customerClient.rpc(
      "set_customer_score",
      toSetCustomerScoreRpcArgs({ customerCompanyId: customerCompany.id, generalScore: null }),
    );
    expect(cleared.error?.code).toBe("42501");

    const unchanged = await adminClient
      .from("customer_scores")
      .select("general_score")
      .eq("customer_company_id", customerCompany.id);
    expect((unchanged.data ?? []).map((row) => Number(row.general_score))).toEqual([2]);
  });

  it("set_customer_score: a deleted customer takes its score with it", async () => {
    const client = await signedInBackofficeClient();
    const customer = await createTestCustomerCompany();
    let deleted = false;
    cleanupFns.push(async () => {
      if (!deleted) await deleteTestCompanyById(customer.id);
    });

    const set = await client.rpc(
      "set_customer_score",
      toSetCustomerScoreRpcArgs({ customerCompanyId: customer.id, generalScore: 4 }),
    );
    expect(set.error).toBeNull();

    // The way the customers screen deletes one: a plain delete under RLS.
    const removal = await client.from("companies").delete().eq("id", customer.id);
    expect(removal.error).toBeNull();
    deleted = true;

    const left = await client
      .from("customer_scores")
      .select("customer_company_id")
      .eq("customer_company_id", customer.id);
    expect(left.data).toEqual([]);
  });
});
