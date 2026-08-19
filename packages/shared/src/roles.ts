import { z } from "zod";

// Admin and Distributor are permission-identical per the PRD — one role,
// not two duplicated ones. Transporter is deliberately excluded: it never
// signs in, so it never gets a Supabase Auth account or a `profiles` row —
// see docs/SCHEMA_DECISIONS.md. Kept dependency-free (no @ori/db) so both
// apps/web (browser bundle) and apps/api can import it directly.
export const userRoleSchema = z.enum(["backoffice", "grower", "customer"]);
export type UserRole = z.infer<typeof userRoleSchema>;

// The single centralized role → home-route resolver. Replaces the PRD's
// per-page duplicated `navigate` branch chains (login form, profile save,
// reset flow) with one named function every entry point calls — R5.
const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  backoffice: "/backoffice",
  grower: "/grower",
  customer: "/customer",
};

export function resolveHomeRoute(role: UserRole): string {
  return ROLE_HOME_ROUTES[role];
}
