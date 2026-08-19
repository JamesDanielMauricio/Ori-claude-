import { z } from "zod";

// One schema + `toRpcArgs` mapper per lifecycle Postgres function
// (packages/db/migrations/0011_lifecycle-functions.sql), mirroring the
// reference-data module's pattern. `close_shop`/`close_arrangement` take
// no arguments — there's nothing to build here for them; the client calls
// `supabase.rpc("close_shop")` directly.

export const initiateBusinessDayInputSchema = z.object({
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)"),
});
export type InitiateBusinessDayInput = z.infer<typeof initiateBusinessDayInputSchema>;

export function toInitiateBusinessDayRpcArgs(input: InitiateBusinessDayInput) {
  return { p_trade_date: input.tradeDate };
}

export const openShopInputSchema = z.object({
  canSeePrices: z.boolean(),
});
export type OpenShopInput = z.infer<typeof openShopInputSchema>;

export function toOpenShopRpcArgs(input: OpenShopInput) {
  return { p_can_see_prices: input.canSeePrices };
}

export const submitPickInputSchema = z.object({
  dailyPickId: z.string().uuid(),
});
export type SubmitPickInput = z.infer<typeof submitPickInputSchema>;

export function toSubmitPickRpcArgs(input: SubmitPickInput) {
  return { p_daily_pick_id: input.dailyPickId };
}

export const updatePickProductPalletsInputSchema = z.object({
  dailyPickProductId: z.string().uuid(),
  palletsPicked: z.number().nonnegative(),
});
export type UpdatePickProductPalletsInput = z.infer<typeof updatePickProductPalletsInputSchema>;

export function toUpdatePickProductPalletsRpcArgs(input: UpdatePickProductPalletsInput) {
  return {
    p_daily_pick_product_id: input.dailyPickProductId,
    p_pallets_picked: input.palletsPicked,
  };
}

// PostgREST surfaces each `raise exception ... using errcode = '...'` as a
// PostgrestError with this code. Named here, once, so the client and the
// tests agree on what each failure mode looks like without re-deriving
// the Postgres error code by hand — see 0011 for where each is raised.
export const LIFECYCLE_ERROR_CODES = {
  /** No row matched (a trading day, pick, or pick-product line that doesn't exist). */
  NOT_FOUND: "P0002",
  /** current_role() <> 'backoffice', or a grower acting on a pick/line that isn't theirs. */
  FORBIDDEN: "42501",
  /** initiate_business_day raced the partial unique index — a trading day is already open. */
  DAY_ALREADY_OPEN: "P0004",
  /** open_shop raced daily_shops' unique trading_day_id — this day already has a shop. */
  SHOP_ALREADY_OPEN: "P0005",
  /** update_pick_product_pallets: the new value is below what's already arranged. */
  ARRANGED_FLOOR_VIOLATION: "P0006",
  /** A phase-transition or status-transition function was called with the day/pick not in the expected prior phase/status (forward-only violation). */
  INVALID_STATE: "P0007",
  /** update_pick_product_pallets: a negative pallet count. */
  INVALID_INPUT: "P0008",
} as const;
