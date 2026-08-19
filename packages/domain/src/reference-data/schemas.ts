import { userRoleSchema } from "@ori/shared/roles";
import { z } from "zod";

// Shared with the two real, PRD-confirmed enums (company_status, pack_type
// — see packages/db/src/schema/enums.ts for why price_type/category are
// left as free text instead of guessed enums).
export const companyStatusSchema = z.enum(["active", "inactive"]);
export const packTypeSchema = z.enum(["pallets", "crates"]);

// One schema + one `toRpcArgs` mapper per `save_*` Postgres function
// (packages/db/migrations/0007_reference-data-functions.sql). Validating
// here, client-side, before the `supabase.rpc()` call is a UX nicety
// (fail fast with field-level errors) — the actual authorization and
// data-integrity boundary is the function + RLS, not this schema.

export const saveGrowerInputSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().min(1),
  status: companyStatusSchema,
  defaultPickupTime: z.string().nullable(),
  whatsappGroupId: z.string().nullable(),
  productVarietyIds: z.array(z.string().uuid()),
  // The transporter assigned to move this grower's arranged produce —
  // id 8's cc target on arrangement finalization (see
  // packages/db/migrations/0031/0033). Nullable: most growers may have no
  // transporter assigned.
  transporterCompanyId: z.string().uuid().nullable(),
});
export type SaveGrowerInput = z.infer<typeof saveGrowerInputSchema>;

export function toSaveGrowerRpcArgs(input: SaveGrowerInput) {
  return {
    p_id: input.id,
    p_name: input.name,
    p_status: input.status,
    p_default_pickup_time: input.defaultPickupTime,
    p_whatsapp_group_id: input.whatsappGroupId,
    p_product_variety_ids: input.productVarietyIds,
    p_transporter_company_id: input.transporterCompanyId,
  };
}

export const saveCustomerInputSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().min(1),
  status: companyStatusSchema,
  canSeeProductPrices: z.boolean().nullable(),
  whatsappGroupId: z.string().nullable(),
});
export type SaveCustomerInput = z.infer<typeof saveCustomerInputSchema>;

export function toSaveCustomerRpcArgs(input: SaveCustomerInput) {
  return {
    p_id: input.id,
    p_name: input.name,
    p_status: input.status,
    p_can_see_product_prices: input.canSeeProductPrices,
    p_whatsapp_group_id: input.whatsappGroupId,
  };
}

export const saveTransporterInputSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().min(1),
  status: companyStatusSchema,
  whatsappGroupId: z.string().nullable(),
});
export type SaveTransporterInput = z.infer<typeof saveTransporterInputSchema>;

export function toSaveTransporterRpcArgs(input: SaveTransporterInput) {
  return {
    p_id: input.id,
    p_name: input.name,
    p_status: input.status,
    p_whatsapp_group_id: input.whatsappGroupId,
  };
}

export const customerPalletCapSchema = z.object({
  customerCompanyId: z.string().uuid(),
  palletCap: z.number().int().nonnegative(),
});

export const saveProductInputSchema = z.object({
  id: z.string().uuid().nullable(),
  familyId: z.string().uuid(),
  name: z.string().min(1),
  sizes: z.string().nullable(),
  packType: packTypeSchema.nullable(),
  price: z.number().nullable(),
  priceRangeFrom: z.number().nullable(),
  priceRangeTo: z.number().nullable(),
  priceType: z.string().nullable(),
  noOverbooking: z.number(),
  highlightPriceFluctuations: z.boolean(),
  isSeasonalAvailable: z.boolean(),
  // Required when updating (the version the client last read); ignored by
  // the function on create. Null only ever legitimately occurs on create.
  expectedVersion: z.number().int().nullable(),
  customerPalletCaps: z.array(customerPalletCapSchema),
});
export type SaveProductInput = z.infer<typeof saveProductInputSchema>;

export function toSaveProductRpcArgs(input: SaveProductInput) {
  return {
    p_id: input.id,
    p_family_id: input.familyId,
    p_name: input.name,
    p_sizes: input.sizes,
    p_pack_type: input.packType,
    p_price: input.price,
    p_price_range_from: input.priceRangeFrom,
    p_price_range_to: input.priceRangeTo,
    p_price_type: input.priceType,
    p_no_overbooking: input.noOverbooking,
    p_highlight_price_fluctuations: input.highlightPriceFluctuations,
    p_is_seasonal_available: input.isSeasonalAvailable,
    p_expected_version: input.expectedVersion,
    p_customer_pallet_caps: input.customerPalletCaps.map((cap) => ({
      customerCompanyId: cap.customerCompanyId,
      palletCap: cap.palletCap,
    })),
  };
}

export const saveUserInputSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().min(1),
  role: userRoleSchema,
  companyId: z.string().uuid(),
  blockedProductVarietyIds: z.array(z.string().uuid()),
});
export type SaveUserInput = z.infer<typeof saveUserInputSchema>;

export function toSaveUserRpcArgs(input: SaveUserInput) {
  return {
    p_user_id: input.userId,
    p_display_name: input.displayName,
    p_role: input.role,
    p_company_id: input.companyId,
    p_blocked_product_variety_ids: input.blockedProductVarietyIds,
  };
}

// PostgREST surfaces a `raise exception ... using errcode = 'P0003'` as a
// PostgrestError with this code — the one distinguishing signal between
// "someone else saved first" (recoverable: reload and retry) and every
// other failure. Deliberately NOT `40001` (Postgres's own
// `serialization_failure` code): the connection-pooling layer between
// PostgREST and Postgres treats that code as a transient, auto-retried
// failure, which turned a legitimate, immediate conflict into a
// many-second hang before it finally surfaced (see
// packages/db/migrations/0008_product-conflict-errcode-fix.sql). Kept here,
// next to the schemas that build the RPC calls, so the client and the
// tests agree on what a conflict looks like without each re-deriving the
// Postgres error code by hand.
export const PRODUCT_VERSION_CONFLICT_ERROR_CODE = "P0003";
