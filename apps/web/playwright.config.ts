import { defineConfig } from "@playwright/test";

// Forwards whatever Supabase project the environment is already configured
// for (see .env / .env.example) — there's only ever one usable
// Auth-backed database, the same one packages/domain and apps/api's own
// test suites target, so e2e doesn't stand up a separate one. Fixtures are
// uniquely named and explicitly torn down (see
// packages/domain/src/auth/test-helpers.ts), which is what actually makes
// sharing it safe, not database-level isolation.
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const API_URL = "http://localhost:4000";

export default defineConfig({
  testDir: "./e2e",
  // Specs share one database and some fixtures sign in as freshly-created
  // users — see packages/domain/vitest.config.ts for the parallelism
  // rationale. Workers are separate processes, so even per-file
  // serialization isn't enough; the whole suite runs as one worker.
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  // The default 5s assertion timeout is tight for the very first
  // interactive request against a freshly-spawned `next start` process
  // talking to a real hosted Postgres/Supabase project — production
  // servers have a genuine cold-start cost (module instantiation, DB
  // connection pool warmup) that local dev's lazy per-route compilation
  // doesn't, so the first sign-in-and-redirect in a run is the one most
  // likely to need it. 10s is a modest, honest accommodation for that,
  // not a blanket flakiness suppressant.
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @ori/api dev",
      url: `${API_URL}/healthz`,
      cwd: "../..",
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL,
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY,
        API_PORT: "4000",
      },
    },
    {
      command: "pnpm start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_API_URL: API_URL,
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
      },
    },
  ],
});
