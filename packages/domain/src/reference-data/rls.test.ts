import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "@ori/domain/auth/testing";
import { afterEach, describe, expect, it } from "vitest";

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

// RLS coverage for every table this module added or changed policies on
// (packages/db/migrations/0006_reference-data-rls.sql) — `companies` and
// `profiles` self/backoffice policies are already covered in
// ../auth/rls.test.ts; this file is specifically the four tables that got
// policies for the first time here: product_families, grower_products,
// product_customer_caps, and a transporter-typed `companies` row (the
// existing companies tests only exercised the grower/generic-type case).
describe("reference-data Row Level Security", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  it("product_families: any authenticated user reads the catalog, only backoffice writes", async () => {
    const family = await createTestProductFamily();
    cleanupFns.push(() => deleteTestProductFamily(family.id));

    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const grower = await createTestProfile({ companyId: company.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(grower.userId));
    const growerClient = await signInTestUser(grower.email, grower.password);

    const read = await growerClient.from("product_families").select("id").eq("id", family.id).single();
    expect(read.error).toBeNull();

    const write = await growerClient
      .from("product_families")
      .update({ name: "Hijacked" })
      .eq("id", family.id)
      .select();
    expect(write.error).toBeNull();
    expect(write.data).toEqual([]);

    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);
    const adminWrite = await adminClient
      .from("product_families")
      .update({ name: "Renamed by backoffice" })
      .eq("id", family.id)
      .select();
    expect(adminWrite.error).toBeNull();
    expect(adminWrite.data).toMatchObject([{ id: family.id }]);
  });

  it("grower_products: a grower reads their own in-season selection, not another grower's", async () => {
    const family = await createTestProductFamily();
    cleanupFns.push(() => deleteTestProductFamily(family.id));
    const product = await createTestProductVariety({ familyId: family.id });
    cleanupFns.push(() => deleteTestProductVariety(product.id));

    const ownGrowerCompany = await createTestGrowerCompany();
    cleanupFns.push(() => deleteTestCompanyById(ownGrowerCompany.id));
    const otherGrowerCompany = await createTestGrowerCompany();
    cleanupFns.push(() => deleteTestCompanyById(otherGrowerCompany.id));

    const grower = await createTestProfile({ companyId: ownGrowerCompany.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(grower.userId));
    const admin = await createTestProfile({ companyId: ownGrowerCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    // Seed both growers' selections as backoffice (the only writer).
    const ownInsert = await adminClient
      .from("grower_products")
      .insert({ company_id: ownGrowerCompany.id, product_variety_id: product.id });
    expect(ownInsert.error).toBeNull();
    const otherInsert = await adminClient
      .from("grower_products")
      .insert({ company_id: otherGrowerCompany.id, product_variety_id: product.id });
    expect(otherInsert.error).toBeNull();

    const growerClient = await signInTestUser(grower.email, grower.password);

    const ownRead = await growerClient
      .from("grower_products")
      .select("company_id")
      .eq("company_id", ownGrowerCompany.id);
    expect(ownRead.error).toBeNull();
    expect(ownRead.data).toEqual([{ company_id: ownGrowerCompany.id }]);

    const otherRead = await growerClient
      .from("grower_products")
      .select("company_id")
      .eq("company_id", otherGrowerCompany.id);
    expect(otherRead.error).toBeNull();
    expect(otherRead.data).toEqual([]);

    const growerWrite = await growerClient
      .from("grower_products")
      .delete()
      .eq("company_id", ownGrowerCompany.id)
      .select();
    expect(growerWrite.error).toBeNull();
    expect(growerWrite.data).toEqual([]);
  });

  it("product_customer_caps: a customer reads their own pallet caps, not another customer's", async () => {
    const family = await createTestProductFamily();
    cleanupFns.push(() => deleteTestProductFamily(family.id));
    const product = await createTestProductVariety({ familyId: family.id });
    cleanupFns.push(() => deleteTestProductVariety(product.id));

    const ownCustomerCompany = await createTestCustomerCompany();
    cleanupFns.push(() => deleteTestCompanyById(ownCustomerCompany.id));
    const otherCustomerCompany = await createTestCustomerCompany();
    cleanupFns.push(() => deleteTestCompanyById(otherCustomerCompany.id));

    const customer = await createTestProfile({ companyId: ownCustomerCompany.id, role: "customer" });
    cleanupFns.push(() => deleteTestUser(customer.userId));
    const admin = await createTestProfile({ companyId: ownCustomerCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    const ownInsert = await adminClient
      .from("product_customer_caps")
      .insert({ product_variety_id: product.id, customer_company_id: ownCustomerCompany.id, pallet_cap: 5 });
    expect(ownInsert.error).toBeNull();
    const otherInsert = await adminClient
      .from("product_customer_caps")
      .insert({ product_variety_id: product.id, customer_company_id: otherCustomerCompany.id, pallet_cap: 9 });
    expect(otherInsert.error).toBeNull();

    const customerClient = await signInTestUser(customer.email, customer.password);

    const ownRead = await customerClient
      .from("product_customer_caps")
      .select("pallet_cap")
      .eq("customer_company_id", ownCustomerCompany.id);
    expect(ownRead.error).toBeNull();
    expect(ownRead.data).toEqual([{ pallet_cap: 5 }]);

    const otherRead = await customerClient
      .from("product_customer_caps")
      .select("pallet_cap")
      .eq("customer_company_id", otherCustomerCompany.id);
    expect(otherRead.error).toBeNull();
    expect(otherRead.data).toEqual([]);

    const customerWrite = await customerClient
      .from("product_customer_caps")
      .update({ pallet_cap: 999 })
      .eq("customer_company_id", ownCustomerCompany.id)
      .select();
    expect(customerWrite.error).toBeNull();
    expect(customerWrite.data).toEqual([]);
  });

  it("companies: a transporter-typed row follows the same self-row-or-backoffice rule as any other type", async () => {
    const transporterCompany = await createTestTransporterCompany();
    cleanupFns.push(() => deleteTestCompanyById(transporterCompany.id));
    const otherCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(otherCompany.id));

    // Transporters never sign in (no `user_role` value for them — see
    // docs/SCHEMA_DECISIONS.md), so the reading identity here is a
    // backoffice user whose own company happens to be a different row,
    // proving the policy doesn't special-case company type at all — it's
    // the same `id = current_company_id()` / `current_role() = 'backoffice'`
    // check regardless of which type the row is.
    const admin = await createTestProfile({ companyId: otherCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    const read = await adminClient
      .from("companies")
      .select("id, type")
      .eq("id", transporterCompany.id)
      .single();
    expect(read.error).toBeNull();
    expect(read.data).toMatchObject({ id: transporterCompany.id, type: "transporter" });

    const nonBackofficeUser = await createTestProfile({ companyId: otherCompany.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(nonBackofficeUser.userId));
    const nonBackofficeClient = await signInTestUser(nonBackofficeUser.email, nonBackofficeUser.password);

    const deniedRead = await nonBackofficeClient
      .from("companies")
      .select("id")
      .eq("id", transporterCompany.id)
      .maybeSingle();
    expect(deniedRead.error).toBeNull();
    expect(deniedRead.data).toBeNull();
  });
});
