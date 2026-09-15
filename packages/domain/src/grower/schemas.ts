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

// Pickup time is a per-grower (company) setting, not a per-product one —
// see companies.default_pickup_time / daily_picks.pickup_time — so this
// function edits only the comment.
export const updatePickProductDetailsInputSchema = z.object({
  dailyPickProductId: z.string().uuid(),
  comment: z.string().nullable(),
});
export type UpdatePickProductDetailsInput = z.infer<typeof updatePickProductDetailsInputSchema>;

export function toUpdatePickProductDetailsRpcArgs(input: UpdatePickProductDetailsInput) {
  return {
    p_daily_pick_product_id: input.dailyPickProductId,
    p_comment: input.comment,
  };
}

// One line's full desired state, not a diff. save_pick_lines (migration 0039)
// compares each line against the stored row itself rather than trusting the
// caller to have worked out what changed — which is what keeps the
// pick_updated notification firing on a real quantity change and not on a
// no-op save.
export const pickLineInputSchema = z.object({
  dailyPickProductId: z.string().uuid(),
  palletsPicked: z.number().nonnegative(),
  // Carried forward from the grower's most recent prior line for this
  // variety by bootstrap_grower_pick/sync_grower_picks (migration 0050),
  // then independently editable here — the arrangement floor below applies
  // to palletsPicked + leftoverPallets combined, not either alone.
  leftoverPallets: z.number().nonnegative(),
  comment: z.string().nullable(),
});
export type PickLineInput = z.infer<typeof pickLineInputSchema>;

// The whole editor's save, as ONE call. Replaces the previous fan-out of one
// update_pick_product_pallets / update_pick_product_details RPC per changed
// line, where each was its own transaction and any one could fail while the
// rest committed — see 0039's header for the failure this closes.
export const savePickLinesInputSchema = z.object({
  dailyPickId: z.string().uuid(),
  lines: z.array(pickLineInputSchema),
});
export type SavePickLinesInput = z.infer<typeof savePickLinesInputSchema>;

export function toSavePickLinesRpcArgs(input: SavePickLinesInput) {
  return {
    p_daily_pick_id: input.dailyPickId,
    p_lines: input.lines.map((line) => ({
      dailyPickProductId: line.dailyPickProductId,
      palletsPicked: line.palletsPicked,
      leftoverPallets: line.leftoverPallets,
      comment: line.comment,
    })),
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
  /** update_pick_product_details, save_pick_lines or send_pick_reminder called against an already-closed pick. */
  INVALID_STATE: "P0007",
  /** save_pick_lines: pallets_picked + leftover_pallets combined below what's already committed in arrangement_records for that line. */
  CONFLICT: "P0006",
  /** save_pick_lines: a negative or missing pallet or leftover count. */
  INVALID_INPUT: "P0008",
} as const;
