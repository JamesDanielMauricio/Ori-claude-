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

// A company's WhatsApp group id is stored bare: whatsapp-dispatch appends
// Green API's "@g.us" itself, so a full chat id pasted in — the form Bubble
// stored it in — would go out as "...@g.us@g.us" and never arrive. Every
// company screen saves through one of the three schemas below, which makes
// this the one place to strip it. A blank field means no group.
const whatsappGroupIdSchema = z
  .string()
  .nullable()
  .transform((value) => value?.trim().replace(/@g\.us$/, "") || null);

export const saveGrowerInputSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().min(1),
  status: companyStatusSchema,
  defaultPickupTime: z.string().nullable(),
  whatsappGroupId: whatsappGroupIdSchema,
  productVarietyIds: z.array(z.string().uuid()),
  // The transporter assigned to move this grower's arranged produce —
  // id 8's cc target on arrangement finalization (see
  // packages/db/migrations/0031/0033). Nullable: most growers may have no
  // transporter assigned.
  transporterCompanyId: z.string().uuid().nullable(),
  // The distributor's point of contact for this company — any profile in
  // the system (see packages/db/migrations/0057). Nullable: most companies
  // have none set.
  contactPersonId: z.string().uuid().nullable(),
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
    p_contact_person_id: input.contactPersonId,
  };
}

export const saveCustomerInputSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().min(1),
  status: companyStatusSchema,
  canSeeProductPrices: z.boolean().nullable(),
  whatsappGroupId: whatsappGroupIdSchema,
  contactPersonId: z.string().uuid().nullable(),
});
export type SaveCustomerInput = z.infer<typeof saveCustomerInputSchema>;

export function toSaveCustomerRpcArgs(input: SaveCustomerInput) {
  return {
    p_id: input.id,
    p_name: input.name,
    p_status: input.status,
    p_can_see_product_prices: input.canSeeProductPrices,
    p_whatsapp_group_id: input.whatsappGroupId,
    p_contact_person_id: input.contactPersonId,
  };
}

// Rounds the way the column does. customer_scores.general_score is
// numeric(3,2), and Postgres rounds the DECIMAL text it is sent, half away
// from zero: 1.005 becomes 1.01. Multiplying by 100 in floating point does
// not — 1.005 is held a hair below 1.005, so it comes out 1.00 — and the
// screen would then show a score the database does not hold. Shifting the
// decimal point in the text, where 1.005 is exactly 1.005, gives the same
// answer the database will.
function roundToTwoDecimals(value: number): number {
  return Number(`${Math.round(Number(`${value}e2`))}e-2`);
}

// A customer's ranking score: the distributor's own scale, 1 (lowest) to 5,
// kept so that an arrangement suggestion can order customers by it when a
// product is short.
//
// The range is checked on the number as given and only then rounded, in that
// order, because that is the order set_customer_score works in: 0.996 is off
// the scale, not a 1.00. Null clears the score — the customer is then
// unranked, which is a real state and not a missing value; leaving the score
// out altogether is neither, and is refused.
//
// Its own input and its own function (set_customer_score, migration 0067),
// not a field on saveCustomerInputSchema: the score is the one thing about a
// customer that the customer must never be able to read, so it is not a
// column of the company row they can — see that migration.
export const setCustomerScoreInputSchema = z.object({
  customerCompanyId: z.string().uuid(),
  generalScore: z.number().min(1).max(5).transform(roundToTwoDecimals).nullable(),
});
export type SetCustomerScoreInput = z.infer<typeof setCustomerScoreInputSchema>;

export function toSetCustomerScoreRpcArgs(input: SetCustomerScoreInput) {
  return {
    p_customer_company_id: input.customerCompanyId,
    p_general_score: input.generalScore,
  };
}

export const saveTransporterInputSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().min(1),
  status: companyStatusSchema,
  whatsappGroupId: whatsappGroupIdSchema,
  contactPersonId: z.string().uuid().nullable(),
});
export type SaveTransporterInput = z.infer<typeof saveTransporterInputSchema>;

export function toSaveTransporterRpcArgs(input: SaveTransporterInput) {
  return {
    p_id: input.id,
    p_name: input.name,
    p_status: input.status,
    p_whatsapp_group_id: input.whatsappGroupId,
    p_contact_person_id: input.contactPersonId,
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
  // Pallets are always whole units — never a fractional pallet.
  noOverbooking: z.number().int(),
  highlightPriceFluctuations: z.boolean(),
  isSeasonalAvailable: z.boolean(),
  // The customer order screen's per-line ceiling (migration 0042). Null
  // means no variety-level cap — see product-variety.ts's own comment for
  // how this differs from customerPalletCaps below (one default for every
  // customer vs. an override for one).
  numberOfOrdersPerCustomer: z.number().int().positive().nullable(),
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
    p_number_of_orders_per_customer: input.numberOfOrdersPerCustomer,
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
