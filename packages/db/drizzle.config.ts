import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/migrations-schema.ts",
  out: "./migrations",
  // Supabase owns and migrates the `auth` schema itself — our migrations
  // must never try to create/alter it. `auth-users.ts`'s shadow table
  // exists only so profiles.user_id can have a typed FK; this filter keeps
  // drizzle-kit from generating DDL for it. See docs/SCHEMA_DECISIONS.md.
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://ori:ori@localhost:5433/ori_dev",
  },
});
