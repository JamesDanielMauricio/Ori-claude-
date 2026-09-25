export class UserNotFoundError extends Error {
  constructor() {
    super("User not found.");
    this.name = "UserNotFoundError";
  }
}

// Why an admin-mediated reset was refused before anything was changed — the
// target is left exactly as it was (still signed in, password untouched, no
// link generated). apps/api's trpc-errors.ts turns each reason into the
// sentence the admin reads.
export type RecoveryLinkUndeliverableReason =
  // An admin resetting their own account through this screen would sign
  // themselves out mid-flow; their own password is changed on
  // /change-password instead.
  | "self_reset"
  // No phone number on the target's profile, so WhatsApp has nowhere to go.
  | "no_phone"
  // A phone number that doesn't normalize to an Israeli number.
  | "invalid_phone"
  // notification_settings.whatsapp_enabled is off — the master switch that
  // blocks every WhatsApp send.
  | "whatsapp_disabled"
  // The server has no Green API credentials for the active environment.
  | "whatsapp_not_configured"
  // Dev environment, and notification_settings.whatsapp_dev_override_phone —
  // where every dev send is redirected — is unset.
  | "dev_phone_missing";

export class RecoveryLinkUndeliverableError extends Error {
  constructor(readonly reason: RecoveryLinkUndeliverableReason) {
    super(`Recovery link cannot be delivered: ${reason}`);
    this.name = "RecoveryLinkUndeliverableError";
  }
}

// The WhatsApp send itself failed AFTER the reset was applied: the target has
// already been signed out and flagged to set a new password, so the admin
// needs to know that retrying is safe and what state the user is in.
export class RecoveryLinkSendFailedError extends Error {
  constructor(readonly detail: string) {
    super(`Recovery link could not be sent: ${detail}`);
    this.name = "RecoveryLinkSendFailedError";
  }
}
