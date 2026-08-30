import "server-only";

import type { UserRole } from "@ori/shared/roles";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { VERIFIED_USER_EMAIL_HEADER, VERIFIED_USER_ID_HEADER } from "./auth-headers";
import { createClient } from "./supabase/server";

export interface CurrentUser {
  userId: string;
  email: string;
  role: UserRole;
  companyId: string;
  displayName: string;
  mustChangePassword: boolean;
}

// Reads the identity middleware.ts already verified for this request,
// falling back to a real `auth.getUser()` when it isn't there.
//
// SECURITY: these headers are safe to read because middleware deletes any
// client-supplied copy before writing its own (see lib/auth-headers.ts) —
// a value here always means "middleware round-tripped to Supabase and this
// token checked out". The fallback covers any request that somehow bypassed
// middleware: absence means "not verified yet", never "not signed in", so
// the guard re-verifies for real rather than assuming either way.
//
// Defence in depth: even if a forged id did reach this function, it grants
// nothing. The profiles read below is RLS-gated by "profiles_select_own"
// (user_id = auth.uid()), and auth.uid() comes from the real JWT in the
// cookie — not from this header. A mismatched id simply selects no row,
// and the caller is treated as signed out.
async function verifiedIdentity(): Promise<{ id: string; email: string } | null> {
  const headerStore = await headers();
  const id = headerStore.get(VERIFIED_USER_ID_HEADER);
  const email = headerStore.get(VERIFIED_USER_EMAIL_HEADER);

  if (id && email) {
    return { id, email: decodeURIComponent(email) };
  }

  const supabase = await createClient();
  // `getUser()`, not `getSession()` — it round-trips to Supabase to verify
  // the token rather than trusting whatever the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.email ? { id: user.id, email: user.email } : null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();

  const user = await verifiedIdentity();
  if (!user) {
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
