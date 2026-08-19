import { z } from "zod";

// One schema + `toRpcArgs` mapper per arrangement Postgres function
// (packages/db/migrations/0021_arrangement-record-functions.sql), mirroring
// the lifecycle-engine/customer modules' pattern. close_arrangement itself
// takes no arguments and already has its schema-less call site in
// lifecycle-engine — this module only covers the New Arrangement write
// surface (create/update/delete a single arrangement record).

export const createArrangementRecordInputSchema = z.object({
  dailyPickProductId: z.string().uuid(),
  dailyOrderProductId: z.string().uuid(),
  quantityPallets: z.number().positive(),
  price: z.number().nonnegative().nullable().optional(),
  priceType: z.string().nullable().optional(),
});
export type CreateArrangementRecordInput = z.infer<typeof createArrangementRecordInputSchema>;

export function toCreateArrangementRecordRpcArgs(input: CreateArrangementRecordInput) {
  return {
    p_daily_pick_product_id: input.dailyPickProductId,
    p_daily_order_product_id: input.dailyOrderProductId,
    p_quantity_pallets: input.quantityPallets,
    p_price: input.price ?? null,
    p_price_type: input.priceType ?? null,
  };
}

export const updateArrangementRecordInputSchema = z.object({
  id: z.string().uuid(),
  quantityPallets: z.number().positive(),
  price: z.number().nonnegative().nullable().optional(),
  priceType: z.string().nullable().optional(),
});
export type UpdateArrangementRecordInput = z.infer<typeof updateArrangementRecordInputSchema>;

export function toUpdateArrangementRecordRpcArgs(input: UpdateArrangementRecordInput) {
  return {
    p_id: input.id,
    p_quantity_pallets: input.quantityPallets,
    p_price: input.price ?? null,
    p_price_type: input.priceType ?? null,
  };
}

export const deleteArrangementRecordInputSchema = z.object({
  id: z.string().uuid(),
});
export type DeleteArrangementRecordInput = z.infer<typeof deleteArrangementRecordInputSchema>;

export function toDeleteArrangementRecordRpcArgs(input: DeleteArrangementRecordInput) {
  return { p_id: input.id };
}

// See packages/domain/src/lifecycle-engine/schemas.ts's LIFECYCLE_ERROR_CODES
// for the full convention this mirrors — these are just the subset this
// module's own functions (0021's create/update/delete_arrangement_record,
// 0022's populate_arrangement_prices) actually raise.
export const ARRANGEMENT_ERROR_CODES = {
  /** No pick line, order line, arrangement record, or daily_arrangements row matched. */
  NOT_FOUND: "P0002",
  /** current_role() <> 'backoffice'. */
  FORBIDDEN: "42501",
  /** create/update/delete_arrangement_record called once the arrangement is closed, or populate_arrangement_prices found a record it can't price. */
  INVALID_STATE: "P0007",
  /** A non-positive quantity, or a pick/order line pair spanning different trading days or varieties. */
  INVALID_INPUT: "P0008",
  /** The requested quantity would exceed the pick line's pallets_picked or the order line's pallets_ordered, summed against every other arrangement record referencing it. */
  OVER_ALLOCATION: "P0009",
} as const;
