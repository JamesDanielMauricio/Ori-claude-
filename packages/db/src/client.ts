import { loadEnv } from "@ori/shared/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import * as schema from "./schema/index";

const env = loadEnv(
  z.object({
    DATABASE_URL: z.string().url(),
  }),
);

// apps/api runs as Vercel serverless functions: every concurrent function
// instance loads this module fresh and opens its own pool, so postgres.js's
// default of 10 connections each can exhaust Postgres's connection limit
// under real traffic. Capping at 1 keeps that bounded — pair with
// DATABASE_URL pointing at Supabase's connection pooler (port 6543,
// transaction mode), which is built for exactly this many-short-lived-
// clients pattern. Transaction mode can hand each query a different server
// connection, so prepared statements (postgres.js's default) aren't
// supported there and are turned off.
const queryClient = postgres(env.DATABASE_URL, { max: 1, prepare: false });

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;
