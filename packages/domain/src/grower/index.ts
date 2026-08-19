// Daily pick entry and revision, and the leftover-pipeline computation that
// runs when a grower's pick closes. See docs/ARCHITECTURE.md § Module
// boundaries.
//
// Like lifecycle-engine, this module holds no service-role-backed
// functions: every action here is a `plpgsql` function invoked directly
// via `supabase.rpc()` from apps/web, under the caller's own RLS-governed
// session. What this module holds is the input schemas both the client
// and the tests build those RPC calls from — see
// packages/db/migrations/0015_grower-pick-functions.sql.
export {
  bootstrapGrowerPickInputSchema,
  toBootstrapGrowerPickRpcArgs,
  type BootstrapGrowerPickInput,
  closeOutPickLeftoversInputSchema,
  toCloseOutPickLeftoversRpcArgs,
  type CloseOutPickLeftoversInput,
  updatePickProductDetailsInputSchema,
  toUpdatePickProductDetailsRpcArgs,
  type UpdatePickProductDetailsInput,
  sendPickReminderInputSchema,
  toSendPickReminderRpcArgs,
  type SendPickReminderInput,
  GROWER_ERROR_CODES,
} from "./schemas";
