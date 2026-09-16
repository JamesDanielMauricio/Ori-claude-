import { randomUUID } from "node:crypto";

import { db } from "@ori/db";
import { companies, profiles } from "@ori/db/schema";
import type { Database } from "@ori/db/supabase-types";
import type { UserRole } from "@ori/shared/roles";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { createServiceRoleClient } from "./supabase-clients";

// Test-only fixtures. Not part of the package's public exports (see
// package.json — nothing under "./auth/test-helpers" is listed) so
// production code can never import them.
//
// These tests run against the one Supabase-Auth-backed Postgres database
// (there's only ever one — GoTrue serves a single configured database, so
// unlike earlier prompts' plain-Postgres suites there's no per-package
// database to isolate into). Isolation instead comes from every fixture
// being uniquely named and explicitly torn down — never a blanket
// truncate, which would also hit concurrently-running suites and
// Supabase's own internal tables.

export async function createTestCompany(
  name = `חברת בדיקה ${randomUUID()}`,
  type: (typeof companies.$inferInsert)["type"] = "backoffice",
) {
  const [company] = await db.insert(companies).values({ name, type }).returning();
  if (!company) throw new Error("failed to create test company");
  return company;
}

export async function deleteTestCompany(companyId: string): Promise<void> {
  await db.delete(companies).where(eq(companies.id, companyId));
}

export interface CreateTestProfileOptions {
  companyId: string;
  role: UserRole;
  email?: string;
  password?: string;
  displayName?: string;
  mustChangePassword?: boolean;
  phoneNumber?: string;
}

export interface TestProfile {
  userId: string;
  email: string;
  password: string;
}

export async function createTestProfile(options: CreateTestProfileOptions): Promise<TestProfile> {
  const email = options.email ?? `test-${randomUUID()}@example.test`;
  const password = options.password ?? `Correct-Horse-${randomUUID()}`;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`failed to create test auth user: ${error?.message ?? "unknown error"}`);
  }

  await db.insert(profiles).values({
    userId: data.user.id,
    companyId: options.companyId,
    role: options.role,
    displayName: options.displayName ?? "משתמש בדיקה",
    mustChangePassword: options.mustChangePassword ?? false,
    phoneNumber: options.phoneNumber,
  });

  return { userId: data.user.id, email, password };
}

// Cascades to the profiles row via ON DELETE CASCADE — no separate cleanup
// needed there.
//
// Retries because the Auth admin API has been observed to transiently fail
// under this suite's own concurrent load (many sign-ins/RPCs firing
// alongside a burst of user deletes) without raising a Node-level
// exception — the original version of this function didn't check `error`
// at all, so a failed delete left the profile (and, transitively, its
// company — profiles.company_id has no cascade) silently orphaned, and
// runCleanup's LIFO loop only discovered the problem several steps later
// when an unrelated company delete hit that orphaned profile's FK and
// aborted the rest of that test's cleanup. Retrying here, where the
// specific failure is known, is more useful than throwing immediately: a
// second attempt a moment later has reliably succeeded in practice.
//
// Paced two ways, based on what's actually been observed:
//
// 1. A fixed settle delay BEFORE THE FIRST attempt, every call, no
//    exceptions. Evidence points at this being the real correlate, not
//    just overall call volume: reducing this suite to a single shared
//    admin (see customer/customer.test.ts) still left deletes failing —
//    including the shared admin's own, at the very end of the file, long
//    after any "burst" of other deletes — but always for a user whose
//    session had just been actively used for several RPC calls
//    immediately beforehand. The working theory is that GoTrue's delete
//    has to tear down that session/its refresh tokens, and doing that
//    immediately after the session was last active contends with
//    something (connection pool, in-flight state) that a short settle
//    window avoids.
// 2. A minimum gap between successive delete *attempts* (module-level, so
//    it applies across every call this process makes, not just
//    consecutive ones inside a single runCleanup chain) — the original
//    mitigation, kept because it's cheap and still plausibly relevant for
//    genuine back-to-back bursts.
const SETTLE_BEFORE_DELETE_MS = 750;
let lastDeleteAttemptStartedAt = 0;
const MIN_GAP_BETWEEN_DELETES_MS = 400;

// If every retry still fails, fall back to deleting just the `profiles`
// row directly (bypassing the Auth admin API, which is what's actually
// failing — the FK only cascades parent-to-child, so removing the child
// row doesn't need the parent auth.users delete to succeed first). This
// is the same manual workaround used throughout the investigation behind
// the comment above, now automatic: it keeps runCleanup from aborting a
// test's whole cleanup chain over a still-undiagnosed Auth-service
// failure, at the cost of leaving one orphaned (profile-less,
// company-less, otherwise inert) auth.users row behind each time it
// triggers. Logged loudly rather than silently, unlike the bug this
// function originally had — an accumulating auth.users row is a "clean
// up periodically" nuisance, not a correctness problem the way a
// silently-orphaned profiles/companies row was.
async function deleteProfileDirectly(userId: string): Promise<void> {
  await db.delete(profiles).where(eq(profiles.userId, userId));
}

export async function deleteTestUser(userId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const attempts = 6;
  let lastError: { message?: string } | null = null;

  await new Promise((resolve) => setTimeout(resolve, SETTLE_BEFORE_DELETE_MS));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const elapsedSinceLastAttempt = Date.now() - lastDeleteAttemptStartedAt;
    if (elapsedSinceLastAttempt < MIN_GAP_BETWEEN_DELETES_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_GAP_BETWEEN_DELETES_MS - elapsedSinceLastAttempt));
    }
    lastDeleteAttemptStartedAt = Date.now();

    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (!error) return;
    lastError = error;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }

  console.warn(
    `[deleteTestUser] Auth admin API failed ${attempts}/${attempts} attempts for ${userId} ` +
      `(${lastError?.message ?? JSON.stringify(lastError)}) — falling back to a direct profiles delete. ` +
      `The auth.users row itself is left behind (orphaned, harmless) until the underlying Auth-service ` +
      `issue is resolved — see docs/ARCHITECTURE.md's customer ordering module section.`,
  );
  await deleteProfileDirectly(userId);
}

export interface TestBackofficeAdmin extends TestProfile {
  companyId: string;
}

// Bundles the "throwaway company, just to get an id for a backoffice
// profile" dance that showed up independently in several test files
// (`signedInBackoffice()` helpers, and — until fixed — five inline
// `createTestProfile({ companyId: (await createTestCompany()).id, ... })`
// call sites in lifecycle.test.ts that never captured the company, so it
// could never be pushed to `cleanupFns` at all and leaked on every run).
// That wasn't a LIFO-ordering mistake like the one fixed in
// docs/ARCHITECTURE.md's customer ordering module section — it was a
// resource created and immediately discarded before anything could hold a
// reference to it. A shared helper that returns (and internally tracks)
// both the company and the profile closes off that failure mode
// structurally: there's no separate "company" variable for a caller to
// forget, because this function is the only thing that ever sees one.
export async function createTestBackofficeAdmin(): Promise<TestBackofficeAdmin> {
  const company = await createTestCompany();
  const profile = await createTestProfile({ companyId: company.id, role: "backoffice" });
  return { ...profile, companyId: company.id };
}

// Deletes in the only order that's safe regardless of what the caller did
// with this admin (signed in, used as `initiated_by`/`performed_by`
// elsewhere, etc.): the profile/auth user first, then the company — never
// the reverse, since profiles.company_id has no cascade back from
// companies. Callers are still responsible for tearing down anything else
// that references this admin's userId (a trading day's `initiated_by`, a
// lifecycle_sessions row's `performed_by`) BEFORE calling this, the same
// as any other `deleteTestUser` call.
export async function deleteTestBackofficeAdmin(admin: TestBackofficeAdmin): Promise<void> {
  await deleteTestUser(admin.userId);
  await deleteTestCompany(admin.companyId);
}

const anonEnv = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
  })
  .parse(process.env);

// A fresh client per call, mimicking what a browser would hold — used to
// sign in as a specific test user and exercise Row Level Security exactly
// as the real client would (never the service-role client, which bypasses
// RLS entirely).
export function createAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(anonEnv.SUPABASE_URL, anonEnv.SUPABASE_ANON_KEY);
}

export async function signInTestUser(
  email: string,
  password: string,
): Promise<SupabaseClient<Database>> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`failed to sign in test user ${email}: ${error.message}`);
  }
  return client;
}

// Runs accumulated per-test cleanup functions in reverse (LIFO) order,
// sequentially. Order matters: fixtures are torn down in the opposite
// order they were created in, mirroring the dependency direction (e.g. a
// profile's company_id FK has no ON DELETE CASCADE, so the user — created
// after, and thus deleted before — must go first). Running these
// concurrently via Promise.all is a real bug, not just slower: it lets
// deletes race past their own foreign keys.
export async function runCleanup(cleanupFns: Array<() => Promise<void>>): Promise<void> {
  const fns = cleanupFns.splice(0).reverse();
  for (const fn of fns) {
    await fn();
  }
}
