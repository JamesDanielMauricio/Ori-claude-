import "server-only";

import type { Database } from "@ori/db/supabase-types";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../public-env";

// Server Components can read cookies but not write them (Next.js
// restriction) — `setAll` becomes a no-op there. That's fine: the actual
// session refresh/cookie write happens in middleware.ts, which runs before
// every request reaches a Server Component.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — writes are a no-op
          // there by design; middleware.ts owns refreshing the cookie.
        }
      },
    },
  });
}
