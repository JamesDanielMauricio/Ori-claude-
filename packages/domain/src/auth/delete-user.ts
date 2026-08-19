import { UserNotFoundError } from "./errors";
import { createServiceRoleClient } from "./supabase-clients";

export interface DeleteUserInput {
  targetUserId: string;
}

// The Users management screen's delete action. Goes through the Supabase
// Admin API rather than a plain RLS-scoped `DELETE FROM profiles` — that
// would remove the profile row but leave the `auth.users` identity behind
// (able to hold a valid session, just with a dangling backoffice-only
// `profiles` read failing everywhere), which is a worse state than either
// "fully gone" or "still a real user". Deleting the auth identity cascades
// to `profiles` (and from there to `profile_blocked_products`) via
// `ON DELETE CASCADE` — see docs/SCHEMA_DECISIONS.md — so there's nothing
// left to clean up on our side.
export async function deleteUser({ targetUserId }: DeleteUserInput): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase.auth.admin.deleteUser(targetUserId);
  if (error) {
    if (error.status === 404) {
      throw new UserNotFoundError();
    }
    throw new Error(`Failed to delete user: ${error.message}`);
  }
}
