import { afterEach, describe, expect, it } from "vitest";

import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "./test-helpers";

// These exercise Row Level Security itself — the primary authorization
// layer per R7 — through the same client/path a browser would use
// (anon key + the signed-in user's own JWT), never the service-role
// client, which bypasses RLS entirely. See docs/SCHEMA_DECISIONS.md and
// packages/db/migrations/0003_row-level-security.sql.
describe("Row Level Security", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  it("a user can read their own profile", async () => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const grower = await createTestProfile({ companyId: company.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(grower.userId));

    const client = await signInTestUser(grower.email, grower.password);
    const { data, error } = await client
      .from("profiles")
      .select("user_id, role")
      .eq("user_id", grower.userId)
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({ user_id: grower.userId, role: "grower" });
  });

  it("a Grower cannot read another Grower's profile", async () => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const growerA = await createTestProfile({ companyId: company.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(growerA.userId));
    const growerB = await createTestProfile({ companyId: company.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(growerB.userId));

    const clientA = await signInTestUser(growerA.email, growerA.password);
    // RLS denial surfaces as zero matching rows, not an error — matching
    // the PRD's documented "row not found, not 403" visibility shape for
    // cross-company/cross-role reads.
    const { data, error } = await clientA
      .from("profiles")
      .select("user_id")
      .eq("user_id", growerB.userId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("a Grower cannot read backoffice-only data — the general 'other profiles' surface", async () => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const grower = await createTestProfile({ companyId: company.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(grower.userId));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    const growerClient = await signInTestUser(grower.email, grower.password);

    // An unscoped select should only ever return the caller's own row —
    // never the admin's, never a full listing.
    const { data, error } = await growerClient.from("profiles").select("user_id");

    expect(error).toBeNull();
    expect(data).toEqual([{ user_id: grower.userId }]);
  });

  it("a backoffice user CAN read another user's profile", async () => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const customer = await createTestProfile({ companyId: company.id, role: "customer" });
    cleanupFns.push(() => deleteTestUser(customer.userId));

    const adminClient = await signInTestUser(admin.email, admin.password);
    const { data, error } = await adminClient
      .from("profiles")
      .select("user_id, role")
      .eq("user_id", customer.userId)
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({ user_id: customer.userId, role: "customer" });
  });

  it("a user can update their own profile but not another user's", async () => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const growerA = await createTestProfile({ companyId: company.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(growerA.userId));
    const growerB = await createTestProfile({ companyId: company.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(growerB.userId));

    const clientA = await signInTestUser(growerA.email, growerA.password);

    const own = await clientA
      .from("profiles")
      .update({ display_name: "Updated Self" })
      .eq("user_id", growerA.userId)
      .select("display_name")
      .single();
    expect(own.error).toBeNull();
    expect(own.data?.display_name).toBe("Updated Self");

    // Zero rows match the policy's `using` clause for someone else's row —
    // the update is a no-op, not an error.
    const other = await clientA
      .from("profiles")
      .update({ display_name: "Hijacked" })
      .eq("user_id", growerB.userId)
      .select("display_name");
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);
  });

  it("current_role() resolves the caller's own role for use inside policies", async () => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    const adminClient = await signInTestUser(admin.email, admin.password);
    const { data, error } = await adminClient.rpc("current_role");

    expect(error).toBeNull();
    expect(data).toBe("backoffice");
  });

  // Superseded by the reference-data module's RLS pass (see
  // docs/SCHEMA_DECISIONS.md, "Reference-data module") — the original
  // blanket "any authenticated user reads every company row" policy from
  // this migration was a placeholder-table-era convenience, and became a
  // real cross-tenant leak once `companies` started holding actual grower/
  // customer/transporter records (company.md: "A leak across companies...
  // is a critical bug"). It's now self-row-or-backoffice, like `profiles`.
  it("a user can read their own company, but only backoffice can write it", async () => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const grower = await createTestProfile({ companyId: company.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(grower.userId));

    const growerClient = await signInTestUser(grower.email, grower.password);

    const read = await growerClient.from("companies").select("id").eq("id", company.id).single();
    expect(read.error).toBeNull();

    const write = await growerClient
      .from("companies")
      .update({ name: "Renamed by a grower" })
      .eq("id", company.id)
      .select();
    expect(write.error).toBeNull();
    expect(write.data).toEqual([]);
  });

  it("a user cannot read another company's row", async () => {
    const ownCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(ownCompany.id));
    const otherCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(otherCompany.id));
    const grower = await createTestProfile({ companyId: ownCompany.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(grower.userId));

    const growerClient = await signInTestUser(grower.email, grower.password);

    const read = await growerClient
      .from("companies")
      .select("id")
      .eq("id", otherCompany.id)
      .maybeSingle();
    expect(read.error).toBeNull();
    expect(read.data).toBeNull();
  });

  it("a backoffice user CAN read any company's row", async () => {
    const ownCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(ownCompany.id));
    const otherCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(otherCompany.id));
    const admin = await createTestProfile({ companyId: ownCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    const adminClient = await signInTestUser(admin.email, admin.password);

    const read = await adminClient
      .from("companies")
      .select("id")
      .eq("id", otherCompany.id)
      .single();
    expect(read.error).toBeNull();
    expect(read.data).toMatchObject({ id: otherCompany.id });
  });
});
