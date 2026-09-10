import { createServiceRoleClient } from "./supabase-clients";

// GoTrue's own maximum page size for the admin list endpoint. Paged rather
// than assumed-single-page: this is a whole-tenant listing, and a silent
// truncation would show a blank email for everyone past the first page
// rather than failing visibly.
const PAGE_SIZE = 1000;

// The Users management screen shows each account's login email — the PRD's
// identity field for a User (reference/prd/user.md) — which lives in
// `auth.users`, not in `profiles`. PostgREST only exposes the `public`
// schema, so the screen's own Supabase query can't reach it and this has
// to come through the service-role Admin API from a trusted server context
// (same reason bulkCreateUsers/deleteUser live here — see
// docs/ARCHITECTURE.md).
//
// Returns id -> email so the caller can join it onto the `profiles` rows it
// already has, instead of this having to know about profiles at all.
export async function listUserEmails(): Promise<Record<string, string>> {
  const supabase = createServiceRoleClient();
  const emails: Record<string, string> = {};

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }
    for (const user of data.users) {
      if (user.email) emails[user.id] = user.email;
    }
    if (data.users.length < PAGE_SIZE) break;
  }

  return emails;
}
