// Matching picked supply to ordered demand, out-of-stock aggregation across
// growers/customers, and the terminal close-arrangement transaction. The
// source of truth for what was actually sold to whom. See
// docs/ARCHITECTURE.md § Module boundaries.
//
// Like grower/customer/lifecycle-engine, this module holds no
// service-role-backed functions: every action here is a `plpgsql` function
// invoked directly via `supabase.rpc()` from apps/web, under the caller's
// own RLS-governed session (arrangement_records' RLS is already
// backoffice-write-only, so no bypass is needed). What this module holds is
// the input schemas both the client and the tests build those RPC calls
// from — see packages/db/migrations/0021_arrangement-record-functions.sql
// and 0022_close-arrangement-pricing-notifications.sql.
//
// Pooled supply/demand reads need no RPC of their own: a backoffice
// session already has full SELECT access to daily_pick_products /
// daily_order_products / arrangement_records / product_varieties /
// companies via existing RLS (unlike the customer module, which needed a
// SECURITY DEFINER cross-tenant helper) — so those queries live directly
// in apps/web's arrangement workspace, same as every other backoffice
// list/detail screen.
export {
  createArrangementRecordInputSchema,
  toCreateArrangementRecordRpcArgs,
  type CreateArrangementRecordInput,
  updateArrangementRecordInputSchema,
  toUpdateArrangementRecordRpcArgs,
  type UpdateArrangementRecordInput,
  arrangeToCustomerInputSchema,
  toArrangeToCustomerRpcArgs,
  type ArrangeToCustomerInput,
  deleteArrangementRecordInputSchema,
  toDeleteArrangementRecordRpcArgs,
  type DeleteArrangementRecordInput,
  ARRANGEMENT_ERROR_CODES,
} from "./schemas";
