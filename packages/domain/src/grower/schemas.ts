import { z } from "zod";

// One schema + `toRpcArgs` mapper per grower-picking Postgres function
// (packages/db/migrations/0015_grower-pick-functions.sql), mirroring the
// lifecycle-engine module's pattern. `bootstrap_grower_pick` and
// `close_out_pick_leftovers` aren't called by application UI directly —
// the former is invoked by `initiate_business_day` and by the
// distributor's "add products" action (composed with `save_grower`), the
// latter only by `close_arrangement` — but both get a schema here too so
// tests can call them exactly the way the client eventually will.

export const bootstrapGrowerPickInputSchema = z.object({
  tradingDayId: z.string().uuid(),
  growerCompanyId: z.string().uuid(),
});
export type BootstrapGrowerPickInput = z.infer<typeof bootstrapGrowerPickInputSchema>;

export function toBootstrapGrowerPickRpcArgs(input: BootstrapGrowerPickInput) {
  return { p_trading_day_id: input.tradingDayId, p_grower_company_id: input.growerCompanyId };
}

export const closeOutPickLeftoversInputSchema = z.object({
  tradingDayId: z.string().uuid(),
});
export type CloseOutPickLeftoversInput = z.infer<typeof closeOutPickLeftoversInputSchema>;

export function toCloseOutPickLeftoversRpcArgs(input: CloseOutPickLeftoversInput) {
  return { p_trading_day_id: input.tradingDayId };
}

// `HH:MM` or `HH:MM:SS` — what an <input type="time"> gives the client and
// what Postgres's `time` type round-trips as text. Null clears the
// per-line override back to "use the grower's default pickup time".
const timeOfDay = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "expected HH:MM or HH:MM:SS")
  .nullable();

export const updatePickProductDetailsInputSchema = z.object({
  dailyPickProductId: z.string().uuid(),
  pickupTime: timeOfDay,
  comment: z.string().nullable(),
});
export type UpdatePickProductDetailsInput = z.infer<typeof updatePickProductDetailsInputSchema>;

export function toUpdatePickProductDetailsRpcArgs(input: UpdatePickProductDetailsInput) {
  return {
    p_daily_pick_product_id: input.dailyPickProductId,
    p_pickup_time: input.pickupTime,
    p_comment: input.comment,
  };
}

export const sendPickReminderInputSchema = z.object({
  dailyPickId: z.string().uuid(),
});
export type SendPickReminderInput = z.infer<typeof sendPickReminderInputSchema>;

export function toSendPickReminderRpcArgs(input: SendPickReminderInput) {
  return { p_daily_pick_id: input.dailyPickId };
}

// See packages/domain/src/lifecycle-engine/schemas.ts's LIFECYCLE_ERROR_CODES
// for the full convention this mirrors — these are just the subset this
// module's own functions (0015) actually raise.
export const GROWER_ERROR_CODES = {
  /** No row matched (a pick or pick-product line that doesn't exist). */
  NOT_FOUND: "P0002",
  /** current_role() <> 'backoffice', or a grower acting on a line that isn't theirs. */
  FORBIDDEN: "42501",
  /** update_pick_product_details or send_pick_reminder called against an already-closed pick. */
  INVALID_STATE: "P0007",
} as const;
