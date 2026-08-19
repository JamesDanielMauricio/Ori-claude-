import type { AppRouter } from "@ori/api/router";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";

import { API_URL } from "./public-env";
import { createClient } from "./supabase/client";

export const trpc = createTRPCReact<AppRouter>();

// Only ever used for the two admin-only, service-role-backed operations
// (bulk import, admin-mediated reset) — everything else talks to Supabase
// directly. Authenticates with the caller's own Supabase access token as a
// bearer header; apps/api verifies it and looks up their role itself (see
// apps/api/src/context.ts) rather than trusting a cookie.
export function trpcClientConfig() {
  const supabase = createClient();

  return {
    links: [
      httpBatchLink({
        url: `${API_URL}/trpc`,
        headers: async () => {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          return session ? { authorization: `Bearer ${session.access_token}` } : {};
        },
      }),
    ],
  };
}
