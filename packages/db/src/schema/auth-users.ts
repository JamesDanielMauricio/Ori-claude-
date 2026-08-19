import { pgSchema, uuid } from "drizzle-orm/pg-core";

const authSchema = pgSchema("auth");

// A shadow reference to Supabase's own `auth.users` table — we don't own,
// migrate, or write to it directly (Supabase Auth/GoTrue does). Declared
// only so Drizzle can express a real foreign key from `public.profiles` to
// it; every column but `id` is deliberately omitted. See
// docs/SCHEMA_DECISIONS.md.
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});
