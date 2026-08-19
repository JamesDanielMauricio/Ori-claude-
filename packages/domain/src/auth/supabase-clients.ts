import type { Database } from "@ori/db/supabase-types";
import { loadEnv } from "@ori/shared/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const env = loadEnv(
  z.object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  }),
);

let cachedClient: SupabaseClient<Database> | null = null;

// Server-only. Holds the service-role key, which bypasses Row Level
// Security and can call the Supabase Admin API (auth.admin.*) — creating
// users, generating recovery links for someone else, etc. Must never be
// exposed to a browser. Every caller of this (apps/api's admin-only
// procedures) is expected to have already independently verified the
// requester is authorized — this client's privilege doesn't imply the
// caller's.
export function createServiceRoleClient(): SupabaseClient<Database> {
  cachedClient ??= createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedClient;
}
