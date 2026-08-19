import { db } from "@ori/db";
import { profiles } from "@ori/db/schema";
import type { UserRole } from "@ori/shared/roles";
import { createClient } from "@supabase/supabase-js";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { eq } from "drizzle-orm";

import { env } from "./env";

// Verifying a bearer token only needs the anon key — it's the same
// operation supabase-js does client-side, just run here so we can look up
// the caller's app-level role afterward. This client never touches the
// service-role key.
const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

export interface AuthenticatedCaller {
  userId: string;
  email: string;
  role: UserRole;
}

// apps/api is a trusted-server boundary distinct from Row Level Security
// (see docs/SCHEMA_DECISIONS.md) — every procedure that reaches here still
// needs its own explicit authorization, which is exactly what
// requireRole/backofficeProcedure in trpc.ts do with the role resolved
// below.
async function resolveCaller(
  authorizationHeader: string | undefined,
): Promise<AuthenticatedCaller | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authorizationHeader.slice("Bearer ".length);

  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user?.email) {
    return null;
  }

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, data.user.id))
    .limit(1);
  if (!profile) {
    return null;
  }

  return { userId: data.user.id, email: data.user.email, role: profile.role };
}

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  const caller = await resolveCaller(req.headers.authorization);
  return { req, res, caller };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
