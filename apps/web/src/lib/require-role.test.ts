import { describe, expect, it } from "vitest";

import { resolveAuthDecision, type AuthDecisionInput } from "./require-role";

// The route guard's decision order is security-adjacent and was inverted
// once during the migration off Next.js (role checked before forced password
// change, which hard signed-out a user who should only have been redirected).
// These pin the order against the behaviour the old server-side
// requireSession()/requireRole() pair had.

const signedIn = (over: Partial<AuthDecisionInput> = {}): AuthDecisionInput => ({
  role: "backoffice",
  loading: false,
  hasUser: true,
  profile: { role: "backoffice", mustChangePassword: false },
  ...over,
});

describe("resolveAuthDecision", () => {
  it("waits while the session is still resolving, rather than assuming signed out", () => {
    expect(resolveAuthDecision(signedIn({ loading: true, hasUser: false, profile: null }))).toEqual(
      { kind: "pending" },
    );
  });

  it("sends an unauthenticated visitor to /login", () => {
    expect(resolveAuthDecision(signedIn({ hasUser: false, profile: null }))).toEqual({
      kind: "redirect",
      to: "/login",
      signOut: false,
    });
  });

  it("treats an authenticated user with no profiles row as signed out (orphan account)", () => {
    expect(resolveAuthDecision(signedIn({ profile: null }))).toEqual({
      kind: "redirect",
      to: "/login",
      signOut: false,
    });
  });

  it("allows a matching role through", () => {
    expect(resolveAuthDecision(signedIn())).toEqual({ kind: "allow" });
  });

  it("hard signs out on a role mismatch, per the PRD access-gating rule", () => {
    expect(
      resolveAuthDecision(signedIn({ profile: { role: "customer", mustChangePassword: false } })),
    ).toEqual({ kind: "redirect", to: "/login", signOut: true });
  });

  it("forces a password change before letting a matching role in", () => {
    expect(
      resolveAuthDecision(signedIn({ profile: { role: "backoffice", mustChangePassword: true } })),
    ).toEqual({ kind: "redirect", to: "/change-password", signOut: false });
  });

  // The regression this ordering exists to prevent: password change wins over
  // the role check, so a provisioned user with a stale bookmark keeps their
  // session instead of being signed out.
  it("prefers /change-password over a hard sign-out when BOTH apply", () => {
    expect(
      resolveAuthDecision(signedIn({ profile: { role: "customer", mustChangePassword: true } })),
    ).toEqual({ kind: "redirect", to: "/change-password", signOut: false });
  });

  describe("an unroled area (/profile — the old requireSession)", () => {
    it("admits any authenticated user regardless of role", () => {
      expect(
        resolveAuthDecision(
          signedIn({ role: undefined, profile: { role: "grower", mustChangePassword: false } }),
        ),
      ).toEqual({ kind: "allow" });
    });

    it("does NOT force a password change, matching requireSession()", () => {
      expect(
        resolveAuthDecision(
          signedIn({ role: undefined, profile: { role: "grower", mustChangePassword: true } }),
        ),
      ).toEqual({ kind: "allow" });
    });

    it("still requires authentication", () => {
      expect(
        resolveAuthDecision(signedIn({ role: undefined, hasUser: false, profile: null })),
      ).toEqual({ kind: "redirect", to: "/login", signOut: false });
    });
  });
});
