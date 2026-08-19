// Companies, users, and the product family/variety catalog — the
// slow-changing data every trading day is built on top of. See
// docs/ARCHITECTURE.md § Module boundaries.
//
// Unlike the auth module, this one holds no service-role-backed functions:
// every multi-field save is a `plpgsql` function
// (packages/db/migrations/0007_reference-data-functions.sql) called
// directly via `supabase.rpc()` from apps/web, running under the caller's
// own RLS-governed session — there's no elevated-privilege operation here
// that needs a trusted server hop. What this module actually holds is the
// input schemas both the client and the tests build those RPC calls from,
// so the two never drift out of sync with each other or with the
// functions' real parameter shapes.
export {
  companyStatusSchema,
  packTypeSchema,
  customerPalletCapSchema,
  saveGrowerInputSchema,
  toSaveGrowerRpcArgs,
  type SaveGrowerInput,
  saveCustomerInputSchema,
  toSaveCustomerRpcArgs,
  type SaveCustomerInput,
  saveTransporterInputSchema,
  toSaveTransporterRpcArgs,
  type SaveTransporterInput,
  saveProductInputSchema,
  toSaveProductRpcArgs,
  type SaveProductInput,
  saveUserInputSchema,
  toSaveUserRpcArgs,
  type SaveUserInput,
  PRODUCT_VERSION_CONFLICT_ERROR_CODE,
} from "./schemas";
