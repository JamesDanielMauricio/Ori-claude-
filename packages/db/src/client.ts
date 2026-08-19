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

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;
