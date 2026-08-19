import "server-only";

import type { UserRole } from "@ori/shared/roles";
import { redirect } from "next/navigation";

import { createClient } from "./supabase/server";

export interface CurrentUser {
  userId: string;
  email: string;
  role: UserRole;
  companyId: string;
  displayName: string;
  mustChangePassword: boolean;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();

  // `getUser()`, not `getSession()` — it round-trips to Supabase to verify
  // the token rather than trusting whatever the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return null;
  }

  // RLS-protected read: the "profiles_select_own" policy is what actually
  // permits this (see docs/SCHEMA_DECISIONS.md) — there's no app-level
  // check standing in for it here.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, company_id, display_name, must_change_password")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email,
    role: profile.role,
    companyId: profile.company_id,
    displayName: profile.display_name,
    mustChangePassword: profile.must_change_password,
  };
}

// The single centralized guard every protected layout calls — one named
// function (R5), not the PRD's pattern of duplicating auth-required /
// role-required checks on every individual page.
export async function requireSession(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requireRole(role: UserRole): Promise<CurrentUser> {
  const user = await requireSession();

  if (user.mustChangePassword) {
    redirect("/change-password");
  }

  if (user.role !== role) {
    // Hard sign-out on a role mismatch, per the PRD's documented
    // access-gating rule — not a soft "wrong role" banner and not a
    // silent redirect to the correct home.
    const supabase = await createClient();
    await supabase.auth.signOut().catch(() => undefined);
    redirect("/login");
  }

  return user;
}
