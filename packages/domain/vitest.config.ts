import { defineConfig } from "vitest/config";

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    // These tests run against the real local Supabase stack (`supabase
    // start`) — no mocked DB or Auth layer, per docs/ARCHITECTURE.md.
    // GoTrue only ever serves one database, so unlike the plain-Postgres
    // suites in earlier prompts there's no separate per-package database to
    // isolate into; every fixture is uniquely named (see
    // src/auth/test-helpers.ts) and explicitly torn down instead, which is
    // safe under full parallelism for fixture-scoped queries.
    //
    // It is NOT safe for the handful of Postgres functions whose own
    // queries are intentionally global rather than fixture-scoped — the
    // single-open-trading-day partial unique index (0009), and
    // initiate_business_day's "every active grower with in-season
    // products" eligibility scan (0011/0015), which has no way to know
    // which grower fixtures belong to which test file. Running test FILES
    // sequentially (not just tests within a file) is what keeps a stray
    // grower fixture from another suite out of a trading day this suite
    // is asserting exact counts against.
    fileParallelism: false,
    // The default 10s hook timeout is tight for afterEach/afterAll chains
    // that tear down several real auth users against the remote Supabase
    // project — deleteTestUser (src/auth/test-helpers.ts) deliberately
    // paces and, on failure, retries those calls with real delays between
    // attempts (a mitigation for observed Auth-admin-API flakiness under
    // this suite's own load), which can legitimately take longer than 10s
    // in the worst case for a single user. Matches the same reasoning
    // already applied to individual slow tests' own `it(..., 30000)`
    // timeouts.
    hookTimeout: 30000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      SUPABASE_URL: process.env.SUPABASE_URL ?? "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? SUPABASE_SERVICE_ROLE_KEY,
    },
  },
});
