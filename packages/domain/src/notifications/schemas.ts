import { z } from "zod";

// One schema + `toRpcArgs` mapper per notifications Postgres function
// (packages/db/migrations/0024_notifications-functions.sql), mirroring
// every other module's pattern.

export const createAlertInputSchema = z.object({
  intendedForUserId: z.string().uuid(),
  alertTypeId: z.string().uuid(),
  displayRecordId: z.string().uuid().nullable().optional(),
  numberForDisplay: z.number().nullable().optional(),
  fullNameForDisplay: z.string().nullable().optional(),
  sendAsWhatsapp: z.boolean().nullable().optional(),
  sendAsNotification: z.boolean().nullable().optional(),
});
export type CreateAlertInput = z.infer<typeof createAlertInputSchema>;

export function toCreateAlertRpcArgs(input: CreateAlertInput) {
  return {
    p_intended_for_user_id: input.intendedForUserId,
    p_alert_type_id: input.alertTypeId,
    p_display_record_id: input.displayRecordId ?? null,
    p_number_for_display: input.numberForDisplay ?? null,
    p_full_name_for_display: input.fullNameForDisplay ?? null,
    p_send_as_whatsapp: input.sendAsWhatsapp ?? null,
    p_send_as_notification: input.sendAsNotification ?? null,
  };
}

// See packages/domain/src/lifecycle-engine/schemas.ts's LIFECYCLE_ERROR_CODES
// for the full convention this mirrors — these are just the subset this
// module's own functions (0024's create_alert, build_arrangement_alerts,
// resolve_outbox_dispatch) actually raise.
export const NOTIFICATION_ERROR_CODES = {
  /** No alert type, target user, notification_outbox row, or notification_templates row matched. */
  NOT_FOUND: "P0002",
  /** current_role() <> 'backoffice' (create_alert, build_arrangement_alerts). */
  FORBIDDEN: "42501",
} as const;
