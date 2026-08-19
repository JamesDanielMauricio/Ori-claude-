// Daily order entry and revision, and out-of-stock visibility for the
// customer-facing shop. See docs/ARCHITECTURE.md § Module boundaries.
//
// Like grower and lifecycle-engine, this module holds no service-role-backed
// functions: every action here is a `plpgsql`/`sql` function invoked
// directly via `supabase.rpc()` from apps/web, under the caller's own
// RLS-governed session. What this module holds is the input schemas both
// the client and the tests build those RPC calls from — see
// packages/db/migrations/0018_customer-order-functions.sql.
export {
  orderableCatalogInputSchema,
  toOrderableCatalogRpcArgs,
  type OrderableCatalogInput,
  orderLineInputSchema,
  type OrderLineInput,
  submitOrderInputSchema,
  toSubmitOrderRpcArgs,
  type SubmitOrderInput,
  sendOrderReminderInputSchema,
  toSendOrderReminderRpcArgs,
  type SendOrderReminderInput,
  CUSTOMER_ERROR_CODES,
} from "./schemas";
