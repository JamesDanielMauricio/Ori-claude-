import { loadEnv } from "@ori/shared/env";
import { z } from "zod";

export const env = loadEnv(
  z.object({
    API_PORT: z.coerce.number().int().positive().default(4000),
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
  }),
);
