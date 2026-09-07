import type { UserRole } from "@ori/shared/roles";
import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";

import { useAuth, type AuthProfile } from "./auth-context";
import { createClient } from "./supabase/client";

// The single centralized route guard every protected area mounts — one
// named component (R5), not the PRD's pattern of duplicating auth-required /
// role-required checks on every individual page. Replaces the server-side
// requireSession()/requireRole() pair the Next.js App Router version ran in
// each role layout.
//
// SECURITY — what this is, and what it is NOT.
//
// This is a *route-reachability* gate: it decides which screens a browser
// will render. It is deliberately NOT the authorization boundary, and it
// must never be treated as one. Because it runs in the browser, a
// determined user can bypass it — they own the JavaScript.
//
// What actually stops a user reading or writing another role's data is Row
// Level Security in Postgres (packages/db/migrations/0003_row-level-security.sql
// and docs/SCHEMA_DECISIONS.md). Every table has RLS enabled, and the
// policies key off `auth.uid()`, which Supabase derives from the signed JWT
// server-side — never from anything this component or any other client code
// asserts. So a user who forces their way past this guard reaches a screen
// whose every query returns an empty set; they gain a layout, not data.
//
// The two service-role operations (bulk user import, admin-mediated password
// reset) bypass RLS by design and are therefore NOT covered by the above.
// Those are gated separately and server-side by apps/api's own requireRole,
// which verifies the caller's Supabase JWT and looks their role up itself
// (apps/api/src/context.ts). That check is unaffected by this file.
//
// Trade-off accepted when migrating off Next.js: the server no longer
// refuses to send the page. An unauthorized user now downloads the JS bundle
// and is bounced here instead. That costs defence-in-depth on route
// visibility; it does not move the data boundary, which was always RLS.

export type AuthDecision =
  { kind: "pending" } | { kind: "allow" } | { kind: "redirect"; to: string; signOut: boolean };

export interface AuthDecisionInput {
  // The role this area demands. Undefined means "any authenticated user" —
  // the old requireSession(), used by /profile.
  role: UserRole | undefined;
  loading: boolean;
  hasUser: boolean;
  profile: Pick<AuthProfile, "role" | "mustChangePassword"> | null;
}

// Extracted as a pure function so the ordering below can be tested without a
// router, a context, or a network — see require-role.test.ts. The order of
// these branches is the whole point of the function and is easy to get
// wrong (it was, once, during the migration off Next.js), so it is pinned by
// tests rather than left to be re-derived by the next reader.
export function resolveAuthDecision({
  role,
  loading,
  hasUser,
  profile,
}: AuthDecisionInput): AuthDecision {
  if (loading) {
    return { kind: "pending" };
  }

  // `!profile` covers two cases the old getCurrentUser() also collapsed into
  // one: not signed in at all, and authenticated with Supabase but missing a
  // `profiles` row — the corrupt/orphan account from the PRD's documented
  // edge case (reference/prd/role-based-routing.md). Neither has anywhere
  // sensible to land, so both go to /login.
  if (!hasUser || !profile) {
    return { kind: "redirect", to: "/login", signOut: false };
  }

  // Unroled areas (/profile) stop here: the old requireSession() checked
  // authentication only, and deliberately did NOT force the password change,
  // so a user mid-forced-change can still reach their own profile.
  if (!role) {
    return { kind: "allow" };
  }

  // Forced password change is evaluated BEFORE the role check, mirroring the
  // old server-side requireRole() exactly. A freshly-provisioned user who
  // lands on the wrong role's area should be sent to /change-password with
  // their session intact — checking role first would hard sign them out
  // instead, so a stale bookmark would cost them their session.
  if (profile.mustChangePassword) {
    return { kind: "redirect", to: "/change-password", signOut: false };
  }

  // A role mismatch is a hard sign-out, per the PRD's documented
  // access-gating rule — not a soft "wrong role" banner and not a silent
  // redirect to the correct home.
  if (profile.role !== role) {
    return { kind: "redirect", to: "/login", signOut: true };
  }

  return { kind: "allow" };
}

// Shown while the auth context resolves the session on first load. Unlike
// the Next.js version — where requireRole() re-ran server-side on *every*
// navigation — this happens once per app load: after that the session lives
// in the AuthProvider and route changes are instant, with no round trip.
function AuthPending() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-72" />
    </div>
  );
}

export function RequireAuth({ role }: { role?: UserRole }) {
  const { user, profile, loading } = useAuth();

  const decision = resolveAuthDecision({
    role,
    loading,
    hasUser: Boolean(user),
    profile,
  });

  // Runs as an effect rather than during render because signOut() is an
  // async side effect; the redirect doesn't wait for it. Signing out also
  // fires onAuthStateChange, which clears the auth context on its own.
  const shouldSignOut = decision.kind === "redirect" && decision.signOut;
  useEffect(() => {
    if (!shouldSignOut) return;
    const supabase = createClient();
    void supabase.auth.signOut().catch(() => undefined);
  }, [shouldSignOut]);

  if (decision.kind === "pending") {
    return <AuthPending />;
  }

  if (decision.kind === "redirect") {
    return <Navigate to={decision.to} replace />;
  }

  return <Outlet />;
}
