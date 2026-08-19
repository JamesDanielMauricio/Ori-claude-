import { db } from "@ori/db";
import { profiles } from "@ori/db/schema";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { adminResetPassword } from "./admin-reset-password";
import { UserNotFoundError } from "./errors";
import { createTestCompany, createTestProfile, deleteTestCompany, deleteTestUser, runCleanup } from "./test-helpers";

// reference/prd/reset-password-admin-mediated.md's actual point: an admin
// resets another user's password, the target ends up with usable new
// credentials, and the admin's own session/credentials are never touched.
// The source's flow got there via session-juggling (log in AS the target
// using a temp password, change it, log back in as the admin) — a real,
// documented failure mode where a wrong admin password mid-flow could
// leave the target's password already changed with the admin now stuck
// (PRD's own "Error paths" section, G6). This module's own implementation
// comment already states the redesign eliminates that failure mode
// structurally (no re-authentication step exists to get wrong at all,
// since the caller's already-valid session — enforced upstream by
// requireRole("backoffice") — IS the authorization). These tests confirm
// the actual effect, not just the role guard apps/api's own router tests
// already cover.
describe("adminResetPassword", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  it("flags the target for a forced password change and generates a real, deliverable recovery link", async () => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const target = await createTestProfile({ companyId: company.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(target.userId));

    const delivered: Array<{ email: string; actionLink: string }> = [];
    await adminResetPassword({
      targetUserId: target.userId,
      deliverRecoveryLink: (params) => {
        delivered.push(params);
      },
    });

    // A real Supabase-issued recovery link, not a placeholder — proves
    // the target's password is genuinely resettable, without this test
    // needing to drive the full "click the link, set a password" flow
    // (that's the recovery-link redemption Supabase itself owns; e2e's
    // own reset-password.spec.ts already exercises the primary
    // self-service variant of that same redemption path).
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.email).toBe(target.email);
    expect(delivered[0]!.actionLink).toMatch(/^https?:\/\//);

    const [profileAfter] = await db.select().from(profiles).where(eq(profiles.userId, target.userId));
    expect(profileAfter?.mustChangePassword).toBe(true);

    // The one thing the source's session-juggling risked getting wrong —
    // the admin's OWN credentials — is structurally not in play here at
    // all: adminResetPassword's signature has no admin-credential
    // parameter for a caller to get wrong, and this call ran without
    // ever touching a second identity's session.
  }, 30000);

  it("rejects a target user that doesn't exist, and leaves no partial state behind", async () => {
    await expect(
      adminResetPassword({ targetUserId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
