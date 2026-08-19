import { db } from "@ori/db";
import { profiles } from "@ori/db/schema";
import { eq } from "drizzle-orm";

import { UserNotFoundError } from "./errors";
import { createServiceRoleClient } from "./supabase-clients";

export type DeliverRecoveryLink = (params: {
  email: string;
  actionLink: string;
}) => Promise<void> | void;

// Actual delivery (email/WhatsApp) is the notifications module's job —
// Prompt 9, not this one. This default is a loud no-op so the gap is
// visible in logs rather than silently swallowed; tests inject their own
// `deliverRecoveryLink` to assert a link was actually generated without
// needing a real transport.
const defaultDeliverRecoveryLink: DeliverRecoveryLink = ({ email }) => {
  console.warn(
    `[auth] Generated a recovery link for ${email} but no delivery channel is wired up yet ` +
      "(see the notifications module). The link was not shown to the admin and not delivered " +
      "anywhere — a known gap until that module lands.",
  );
};

export interface AdminResetPasswordInput {
  targetUserId: string;
  deliverRecoveryLink?: DeliverRecoveryLink;
}

// Admin-mediated reset (reference/prd/reset-password-admin-mediated.md).
// No session-juggling: the admin authorizes this with their own,
// already-valid session (enforced by apps/api's requireRole("backoffice")
// before this ever runs) and never re-enters credentials, so there's no
// "wrong admin password leaves the target half-changed" failure mode (PRD
// known gap G6) — there's no re-authentication step to get wrong. The
// generated link is single-use and time-limited by Supabase itself and,
// unlike bulk import's created-account links, is never returned to the
// admin's response — only handed to the delivery seam, matching "sent to
// the user rather than displayed to the admin."
export async function adminResetPassword({
  targetUserId,
  deliverRecoveryLink = defaultDeliverRecoveryLink,
}: AdminResetPasswordInput): Promise<void> {
  const supabase = createServiceRoleClient();

  const [target] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, targetUserId))
    .limit(1);
  if (!target) {
    throw new UserNotFoundError();
  }

  const { data: authUser, error: getUserError } =
    await supabase.auth.admin.getUserById(targetUserId);
  if (getUserError || !authUser.user?.email) {
    throw new UserNotFoundError();
  }

  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: authUser.user.email,
  });
  if (linkError || !link) {
    throw new Error(`Failed to generate a recovery link: ${linkError?.message ?? "unknown error"}`);
  }

  await db
    .update(profiles)
    .set({ mustChangePassword: true, updatedAt: new Date() })
    .where(eq(profiles.userId, targetUserId));

  await deliverRecoveryLink({
    email: authUser.user.email,
    actionLink: link.properties.action_link,
  });
}
