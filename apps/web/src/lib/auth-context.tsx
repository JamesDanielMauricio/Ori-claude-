"use client";

import type { UserRole } from "@ori/shared/roles";
import type { User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { createClient } from "./supabase/client";

export interface AuthProfile {
  role: UserRole;
  displayName: string;
  companyId: string;
  companyName: string | null;
  mustChangePassword: boolean;
}

export interface AuthState {
  user: User | null;
  profile: AuthProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, profile: null, loading: true });

// The one client-side source of session truth — no custom token store.
// `onAuthStateChange` is Supabase's own event stream (sign-in, sign-out,
// token refresh, and cross-tab sign-out, since it reacts to the same
// cookie/storage every tab shares), so this component only ever mirrors it
// rather than re-deriving session state on its own.
//
// This is *display* state, not a second authorization layer: the role read
// here comes from a `profiles` self-select that Row Level Security already
// scopes to "your own row" (see docs/SCHEMA_DECISIONS.md and
// packages/db/migrations/0003_row-level-security.sql). It decides what the
// shell renders (which nav labels, whose name in the header); it is not
// what decides which data a request is allowed to move — RLS still does
// that unconditionally, and the server-side `requireRole` guard in each
// role layout still decides which routed area is reachable at all.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, profile: null, loading: true });

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function loadProfile(user: User | null) {
      if (!user) {
        if (active) setState({ user: null, profile: null, loading: false });
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("role, display_name, company_id, must_change_password, companies(name)")
        .eq("user_id", user.id)
        .single();

      if (!active) return;

      setState({
        user,
        profile: data
          ? {
              role: data.role,
              displayName: data.display_name,
              companyId: data.company_id,
              companyName: data.companies?.name ?? null,
              mustChangePassword: data.must_change_password,
            }
          : null,
        loading: false,
      });
    }

    void supabase.auth.getUser().then(({ data }) => loadProfile(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadProfile(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
