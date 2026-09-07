import type { Database } from "@ori/db/supabase-types";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../public-env";

// The browser client — used directly by components for sign-in, sign-out,
// password change/reset, and any RLS-protected `.from()` reads (e.g. the
// caller's own profile). This is the identity provider itself; there's no
// API round-trip for any of that. Only the two operations that need the
// service-role key (bulk import, admin-mediated reset) go through apps/api
// instead — see docs/ARCHITECTURE.md.
//
// Plain `@supabase/supabase-js`, not `@supabase/ssr`'s createBrowserClient.
// The SSR package exists to keep the session in cookies so a server render
// can read it; with no server render, that's machinery we no longer need.
// This client stores the session in localStorage and refreshes the access
// token on a timer in the browser — precisely the job the old middleware.ts
// was doing per request, now handled by the library itself.
//
// SECURITY: the anon key is a publishable key, meant to ship in the client
// bundle. It grants nothing on its own — every table is RLS-protected, and
// policies key off `auth.uid()` from the signed JWT, so this key alone
// authorizes no read or write.
let client: SupabaseClient<Database> | null = null;

// Memoized deliberately, and this is load-bearing rather than an
// optimization. `createBrowserClient` was memoized inside @supabase/ssr;
// the plain factory is not, and callers here treat createClient() as cheap
// — AlertsBell, for one, calls it in the component body on every render.
// Each raw client spins up its own auth instance with its own refresh timer
// and its own storage listener, which is what produces the "Multiple
// GoTrueClient instances detected" warning and, worse, lets two timers race
// to refresh the same token. One instance per tab keeps a single writer for
// the session.
export function createClient(): SupabaseClient<Database> {
  client ??= createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
