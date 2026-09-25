import { randomUUID } from "node:crypto";

import { db } from "@ori/db";
import { profiles } from "@ori/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { adminResetPassword, type RecoveryLinkDelivery } from "./admin-reset-password";
import { RecoveryLinkUndeliverableError, UserNotFoundError } from "./errors";
import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "./test-helpers";

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

// Stands in for WhatsApp: records the link instead of sending it.
function recordingDelivery(delivered: string[]): RecoveryLinkDelivery {
  return {
    prepare: async () => async (actionLink) => {
      delivered.push(actionLink);
      return { lastDigits: "0000", devRedirected: false };
    },
  };
}

// Refuses the way the WhatsApp delivery does for a user with no phone.
const refusingDelivery: RecoveryLinkDelivery = {
  prepare: async () => {
    throw new RecoveryLinkUndeliverableError("no_phone");
  },
};

async function sessionCount(userId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from auth.sessions where user_id = ${userId}`,
  );
  return rows[0]?.n ?? 0;
}

async function mustChangePassword(userId: string): Promise<boolean | undefined> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  return profile?.mustChangePassword;
}

describe("adminResetPassword", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  async function signedInTarget() {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const target = await createTestProfile({ companyId: company.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(target.userId));
    const targetClient = await signInTestUser(target.email, target.password);
    return { target, targetClient };
  }

  it("delivers a real recovery link, flags a forced password change and ends every existing login", async () => {
    const { target, targetClient } = await signedInTarget();
    expect(await sessionCount(target.userId)).toBeGreaterThan(0);

    const delivered: string[] = [];
    const receipt = await adminResetPassword({
      targetUserId: target.userId,
      actorUserId: randomUUID(),
      delivery: recordingDelivery(delivered),
    });

    // A real Supabase-issued recovery link, not a placeholder — proves
    // the target's password is genuinely resettable, without this test
    // needing to drive the full "click the link, set a password" flow
    // (that's the recovery-link redemption Supabase itself owns).
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatch(/^https?:\/\//);
    expect(receipt).toEqual({ lastDigits: "0000", devRedirected: false });

    expect(await mustChangePassword(target.userId)).toBe(true);

    // "Signed out everywhere": the session is gone, so the device that was
    // logged in can no longer renew its login.
    expect(await sessionCount(target.userId)).toBe(0);
    const { error: refreshError } = await targetClient.auth.refreshSession();
    expect(refreshError).not.toBeNull();
  }, 30000);

  it("changes nothing when the link can't be delivered", async () => {
    const { target } = await signedInTarget();
    const sessionsBefore = await sessionCount(target.userId);

    await expect(
      adminResetPassword({
        targetUserId: target.userId,
        actorUserId: randomUUID(),
        delivery: refusingDelivery,
      }),
    ).rejects.toMatchObject({ reason: "no_phone" });

    expect(await mustChangePassword(target.userId)).toBe(false);
    expect(await sessionCount(target.userId)).toBe(sessionsBefore);
  }, 30000);

  it("refuses an admin resetting their own account, and changes nothing", async () => {
    const { target } = await signedInTarget();
    const delivered: string[] = [];

    await expect(
      adminResetPassword({
        targetUserId: target.userId,
        actorUserId: target.userId,
        delivery: recordingDelivery(delivered),
      }),
    ).rejects.toMatchObject({ reason: "self_reset" });

    expect(delivered).toHaveLength(0);
    expect(await mustChangePassword(target.userId)).toBe(false);
  }, 30000);

  it("rejects a target user that doesn't exist, and leaves no partial state behind", async () => {
    await expect(
      adminResetPassword({
        targetUserId: "00000000-0000-0000-0000-000000000000",
        actorUserId: randomUUID(),
        delivery: recordingDelivery([]),
      }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
