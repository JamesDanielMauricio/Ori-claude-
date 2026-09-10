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
  // Pallets are always whole units — never a fractional pallet.
  quantityPallets: z.number().int().positive(),
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
  quantityPallets: z.number().int().positive(),
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

// The arrangement board's ✓ button (migration 0040). One idempotent
// "this customer gets N pallets off this grower's line", rather than the
// client choosing between create and update — it cannot know whether a
// record exists without a round trip, and two presses would race.
//
// There is no `dailyOrderProductId` here on purpose: the customer may not
// have an order line for this variety at all, and creating one at zero
// pallets is part of what the function does.
export const arrangeToCustomerInputSchema = z.object({
  dailyPickProductId: z.string().uuid(),
  customerCompanyId: z.string().uuid(),
  quantityPallets: z.number().int().positive(),
  price: z.number().nonnegative().nullable().optional(),
  priceType: z.string().nullable().optional(),
});
export type ArrangeToCustomerInput = z.infer<typeof arrangeToCustomerInputSchema>;

export function toArrangeToCustomerRpcArgs(input: ArrangeToCustomerInput) {
  return {
    p_daily_pick_product_id: input.dailyPickProductId,
    p_customer_company_id: input.customerCompanyId,
    p_quantity_pallets: input.quantityPallets,
    // Null means "leave whatever is already on the record" here, not
    // "clear it" — arrange_to_customer COALESCEs these onto the existing
    // row precisely so a quantity press can't blank a price. That is the
    // opposite of update_arrangement_record above, which assigns them.
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
