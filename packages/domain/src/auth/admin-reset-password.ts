import { db } from "@ori/db";
import { profiles } from "@ori/db/schema";
import { eq, sql } from "drizzle-orm";

import { RecoveryLinkUndeliverableError, UserNotFoundError } from "./errors";
import { createServiceRoleClient } from "./supabase-clients";

// Where a reset link was sent. The number itself is never returned to the
// admin's screen — only its last four digits, enough to confirm it's the
// right person.
export interface RecoveryLinkReceipt {
  lastDigits: string;
  // True in the dev environment, where the message went to the configured
  // test phone instead of the user (see whatsapp-recovery-delivery.ts).
  devRedirected: boolean;
}

export type SendRecoveryLink = (actionLink: string) => Promise<RecoveryLinkReceipt>;

// How the link reaches the user. Split in two so that everything able to
// refuse — no phone number, WhatsApp switched off, no credentials — is
// checked by `prepare` BEFORE the reset changes anything; only the send it
// returns runs afterwards. apps/api passes the WhatsApp implementation
// (createWhatsAppRecoveryDelivery); tests pass a fake that records the link.
export interface RecoveryLinkDelivery {
  prepare(recipient: { displayName: string; phoneNumber: string | null }): Promise<SendRecoveryLink>;
}

export interface AdminResetPasswordInput {
  targetUserId: string;
  // The admin performing the reset, so resetting their own account through
  // this flow can be refused (see RecoveryLinkUndeliverableReason).
  actorUserId: string;
  delivery: RecoveryLinkDelivery;
  // Where the link lands once Supabase has verified it. Supabase only honours
  // an address on the project's redirect allow-list and otherwise falls back
  // to the Site URL; the self-service reset already sends people to
  // /change-password the same way.
  redirectTo?: string | undefined;
}

// Admin-mediated reset (reference/prd/reset-password-admin-mediated.md).
// No session-juggling: the admin authorizes this with their own,
// already-valid session (enforced by apps/api's requireRole("backoffice")
// before this ever runs) and never re-enters credentials, so there's no
// "wrong admin password leaves the target half-changed" failure mode (PRD
// known gap G6) — there's no re-authentication step to get wrong. The
// generated link is single-use and time-limited by Supabase itself and,
// unlike bulk import's created-account links, is never returned to the
// admin's response — it goes to the user's own WhatsApp, matching "sent to
// the user rather than displayed to the admin."
//
// The order below is what keeps every failure explainable:
//   1. everything that can refuse is checked first — nothing has changed;
//   2. the link is generated — still nothing has changed for the user;
//   3. the reset is applied: every existing login is ended and the account
//      is flagged to set a new password;
//   4. the link is sent. If only this fails, the admin is told the user is
//      already signed out and flagged, and that trying again is safe (a new
//      link simply replaces the old one).
export async function adminResetPassword({
  targetUserId,
  actorUserId,
  delivery,
  redirectTo,
}: AdminResetPasswordInput): Promise<RecoveryLinkReceipt> {
  const supabase = createServiceRoleClient();

  const [target] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, targetUserId))
    .limit(1);
  if (!target) {
    throw new UserNotFoundError();
  }
  if (targetUserId === actorUserId) {
    throw new RecoveryLinkUndeliverableError("self_reset");
  }

  const { data: authUser, error: getUserError } =
    await supabase.auth.admin.getUserById(targetUserId);
  if (getUserError || !authUser.user?.email) {
    throw new UserNotFoundError();
  }

  const send = await delivery.prepare({
    displayName: target.displayName,
    phoneNumber: target.phoneNumber,
  });

  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: authUser.user.email,
    ...(redirectTo ? { options: { redirectTo } } : {}),
  });
  if (linkError || !link) {
    throw new Error(`Failed to generate a recovery link: ${linkError?.message ?? "unknown error"}`);
  }

  // One transaction, so the user is never left signed out without the flag
  // or flagged while still signed in.
  //
  // SECURITY: deleting the user's auth.sessions rows is what "signed out
  // everywhere" means in Supabase — each session's refresh tokens are removed
  // with it (refresh_tokens.session_id is ON DELETE CASCADE), so no device
  // can renew its login, and Supabase Auth rejects a token whose session no
  // longer exists. An access token already issued stays valid until it
  // expires (at most an hour), which is the most any JWT-based system can
  // promise. This ALLOWS the reset to lock out whoever holds the account now
  // — including someone who shouldn't — and PROTECTS AGAINST a reset done
  // because an account was compromised leaving the intruder logged in. It
  // runs over apps/api's own database connection (the owner role), which is
  // the only caller of this function, after the backoffice check upstream.
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from auth.sessions where user_id = ${targetUserId}`);
    await tx
      .update(profiles)
      .set({ mustChangePassword: true, updatedAt: new Date() })
      .where(eq(profiles.userId, targetUserId));
  });

  return send(link.properties.action_link);
}
