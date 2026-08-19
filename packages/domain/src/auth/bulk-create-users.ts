import { randomBytes } from "node:crypto";

import { db } from "@ori/db";
import { companies, profiles } from "@ori/db/schema";
import type { UserRole } from "@ori/shared/roles";
import { inArray } from "drizzle-orm";

import { normalizeEmail } from "./email";
import { createServiceRoleClient } from "./supabase-clients";

export interface BulkCreateUserInput {
  email: string;
  displayName: string;
  role: UserRole;
  companyId: string;
}

export type BulkCreateUserResult =
  | { email: string; status: "created"; role: UserRole; userId: string; recoveryLink: string }
  | {
      email: string;
      status: "skipped";
      reason: "duplicate_in_batch" | "email_already_in_use" | "unknown_company" | "create_failed";
    };

export interface BulkCreateUsersInput {
  rows: BulkCreateUserInput[];
}

// Admin provisioning of new accounts — grounded in the PRD's documented
// "Users: User accounts and role assignments, Full read/write" backoffice
// capability. Every created account gets a Supabase-issued recovery link
// (single-use, time-limited, verified by Supabase itself) rather than any
// password we generate and hand out ourselves — there is no plaintext
// credential anywhere in this flow, unlike the PRD's `created_pass_text`
// bug (R1/R6). `must_change_password` forces the first sign-in to end at
// the change-password screen regardless of how the account was reached.
export async function bulkCreateUsers({
  rows,
}: BulkCreateUsersInput): Promise<BulkCreateUserResult[]> {
  const supabase = createServiceRoleClient();
  const results: BulkCreateUserResult[] = new Array(rows.length);
  const seenInBatch = new Set<string>();
  const candidateIndices: number[] = [];

  for (const [index, row] of rows.entries()) {
    const email = normalizeEmail(row.email);
    if (seenInBatch.has(email)) {
      results[index] = { email, status: "skipped", reason: "duplicate_in_batch" };
      continue;
    }
    seenInBatch.add(email);
    candidateIndices.push(index);
  }

  const candidateCompanyIds = [...new Set(candidateIndices.map((i) => rows[i]!.companyId))];
  const existingCompanies = candidateCompanyIds.length
    ? await db
        .select({ id: companies.id })
        .from(companies)
        .where(inArray(companies.id, candidateCompanyIds))
    : [];
  const knownCompanyIds = new Set(existingCompanies.map((c) => c.id));

  for (const index of candidateIndices) {
    const row = rows[index]!;
    const email = normalizeEmail(row.email);

    if (!knownCompanyIds.has(row.companyId)) {
      results[index] = { email, status: "skipped", reason: "unknown_company" };
      continue;
    }

    // A random password the admin never sees and the user never needs —
    // account access is exclusively via the recovery link generated below.
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: randomBytes(32).toString("base64url"),
      email_confirm: true,
    });

    if (createError || !created.user) {
      const alreadyExists = /already.*registered|already.*exists/i.test(createError?.message ?? "");
      results[index] = alreadyExists
        ? { email, status: "skipped", reason: "email_already_in_use" }
        : { email, status: "skipped", reason: "create_failed" };
      continue;
    }

    const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
    });

    if (linkError || !link) {
      results[index] = { email, status: "skipped", reason: "create_failed" };
      continue;
    }

    await db.insert(profiles).values({
      userId: created.user.id,
      companyId: row.companyId,
      role: row.role,
      displayName: row.displayName,
      mustChangePassword: true,
    });

    results[index] = {
      email,
      status: "created",
      role: row.role,
      userId: created.user.id,
      recoveryLink: link.properties.action_link,
    };
  }

  return results;
}
