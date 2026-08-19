"use client";

import type { Database } from "@ori/db/supabase-types";
import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../public-env";

// The browser client — used directly by client components for sign-in,
// sign-out, password change/reset, and any RLS-protected `.from()` reads
// (e.g. the caller's own profile). This is the identity provider itself;
// there's no API round-trip for any of that. Only the two operations that
// need the service-role key (bulk import, admin-mediated reset) go through
// apps/api instead — see docs/ARCHITECTURE.md.
export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
