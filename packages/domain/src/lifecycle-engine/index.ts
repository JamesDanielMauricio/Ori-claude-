// The single source of truth for trading-day phase (initiated / shop open /
// shop closed / arrangement closed) and the transactional transition
// functions between phases. Replaces the Bubble app's singleton
// "app settings" pointer record with a real, queryable trading-day
// aggregate. See docs/ARCHITECTURE.md § Module boundaries.
//
// Like the reference-data module, this one holds no service-role-backed
// functions: every phase transition (and the two grower-initiated,
// rule-guarded edits) is a `plpgsql` function invoked directly via
// `supabase.rpc()` from apps/web, under the caller's own RLS-governed
// session. What this module holds is the input schemas both the client
// and the tests build those RPC calls from, plus the error-code constants
// that name each function's failure modes, so the two never drift apart —
// see packages/db/migrations/0009-0012.
export {
  initiateBusinessDayInputSchema,
  toInitiateBusinessDayRpcArgs,
  type InitiateBusinessDayInput,
  openShopInputSchema,
  toOpenShopRpcArgs,
  type OpenShopInput,
  submitPickInputSchema,
  toSubmitPickRpcArgs,
  type SubmitPickInput,
  updatePickProductPalletsInputSchema,
  toUpdatePickProductPalletsRpcArgs,
  type UpdatePickProductPalletsInput,
  LIFECYCLE_ERROR_CODES,
} from "./schemas";
