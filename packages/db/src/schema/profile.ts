import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { authUsers } from "./auth-users";
import { companies } from "./company";
import { userRoleEnum } from "./enums";

// The "ours" extension of a Supabase Auth identity. One row per
// login-capable user, keyed by (and cascade-deleted with) the
// corresponding `auth.users` row. Email and credentials live in
// `auth.users`, managed entirely by Supabase — see docs/SCHEMA_DECISIONS.md.
export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  role: userRoleEnum("role").notNull(),
  displayName: text("display_name").notNull(),
  // Nullable — the source's edit-profile screen treats phone as an
  // optional editable field (see reference/prd/edit-profile.md), and it's
  // also the source of the individual-WhatsApp-dispatch batch
  // (close-arrangement-phase-4-terminal.md action 8: "no group_id" ->
  // per-user phone, 972-prefixed, leading 0 stripped) — a user with no
  // phone on file simply isn't reachable by that batch, not an error.
  phoneNumber: text("phone_number"),
  // Set on bulk-import/admin-mediated reset (the user is on a Supabase
  // recovery link, not a password they chose); cleared by the client the
  // moment they successfully call `auth.updateUser({ password })` — see
  // apps/web's change-password page and the "profiles_update_own" RLS
  // policy that permits that self-write.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
