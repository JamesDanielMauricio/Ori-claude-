import type { UserRole } from "@ori/shared/roles";
import type { User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  // Forces a re-read of the `profiles` row for the current user. Needed
  // because this context is now what the route guard reads: anything that
  // writes to the caller's own profile row has to tell the context, or the
  // guard keeps deciding on the pre-write copy. See change-password.tsx.
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => undefined,
});

// The one client-side source of session truth — no custom token store.
// `onAuthStateChange` is Supabase's own event stream (sign-in, sign-out,
// token refresh, and cross-tab sign-out, since it reacts to the same
// storage every tab shares), so this component only ever mirrors it rather
// than re-deriving session state on its own.
//
// This is *display* state AND what lib/require-role.tsx gates routes on, but
// it is still not an authorization layer: the role read here comes from a
// `profiles` self-select that Row Level Security already scopes to "your own
// row" (see docs/SCHEMA_DECISIONS.md and
// packages/db/migrations/0003_row-level-security.sql). It decides what the
// shell renders and which routed area is reachable; it is not what decides
// which data a request is allowed to move — RLS still does that
// unconditionally, and the service-role operations in apps/api are still
// gated by that app's own server-side requireRole.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, "refreshProfile">>({
    user: null,
    profile: null,
    loading: true,
  });

  // Lets loadProfile decide whether this is a *new* identity (show the
  // pending state) or a refresh of one already on screen (don't). Held in a
  // ref rather than read from `state` so the callback doesn't need `state`
  // as a dependency, which would re-subscribe onAuthStateChange on every
  // profile change.
  const currentRef = useRef<{ userId: string | null; hasProfile: boolean }>({
    userId: null,
    hasProfile: false,
  });

  // Sequence number for in-flight profile reads. Auth events can overlap —
  // a sign-out arriving while a sign-in's profile fetch is still open is the
  // realistic case — and without this the slower response wins on arrival
  // order, which would re-populate a user who has just signed out.
  const requestRef = useRef(0);

  const loadProfile = useCallback(async (user: User | null) => {
    const requestId = ++requestRef.current;

    if (!user) {
      currentRef.current = { userId: null, hasProfile: false };
      setState({ user: null, profile: null, loading: false });
      return;
    }

    // Signing in is two steps from this context's point of view: Supabase
    // reports the user, then we fetch their profile row. Between those, the
    // honest answer to "who is this and what may they see" is "still
    // resolving" — so `loading` goes back to true and the route guard waits.
    //
    // Without this, the guard would read {user: null, profile: null,
    // loading: false} in that window and treat a user who just signed in
    // successfully as signed out, bouncing them back to /login. The Next.js
    // version never hit this because every navigation re-ran the check
    // server-side against the database.
    //
    // Skipped when the same user's profile is already loaded — an hourly
    // TOKEN_REFRESHED event should not blank the screen behind a skeleton.
    const isSameLoadedUser = currentRef.current.userId === user.id && currentRef.current.hasProfile;
    if (!isSameLoadedUser) {
      currentRef.current = { userId: user.id, hasProfile: false };
      setState({ user, profile: null, loading: true });
    }

    // RLS-protected read: the "profiles_select_own" policy is what permits
    // this — there's no app-level check standing in for it here.
    //
    // `companies!company_id(...)`, not the bare `companies(...)` this used
    // before migration 0057: once `companies.contact_person_id` added a
    // SECOND foreign key back to `profiles`, PostgREST could no longer infer
    // which relationship this embed meant and started rejecting the query
    // with 300 Multiple Choices — silently, from this component's point of
    // view, since `data` just came back undefined. That left the guard
    // treating every freshly signed-in user as profile-less and bouncing
    // them straight back to /login with no error shown. The `!company_id`
    // hint pins it to the `profiles.company_id -> companies.id` relationship
    // explicitly.
    const { data } = await createClient()
      .from("profiles")
      .select("role, display_name, company_id, must_change_password, companies!company_id(name)")
      .eq("user_id", user.id)
      .single();

    // A newer auth event has superseded this read — drop it rather than
    // overwriting whatever that newer event already decided.
    if (requestId !== requestRef.current) {
      return;
    }

    currentRef.current = { userId: user.id, hasProfile: Boolean(data) };
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
  }, []);

  const refreshProfile = useCallback(async () => {
    const {
      data: { user },
    } = await createClient().auth.getUser();
    await loadProfile(user);
  }, [loadProfile]);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    // Stops a fetch being started by an event that arrives after unmount.
    const loadIfActive = (user: User | null) => {
      if (active) void loadProfile(user);
    };

    void supabase.auth.getUser().then(({ data }) => loadIfActive(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      loadIfActive(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  // Memoized so a re-render that doesn't touch `state` or `refreshProfile`
  // (refreshProfile is itself stable via useCallback) doesn't hand every
  // useAuth() consumer a new object reference and force them all to
  // re-render together.
  const value = useMemo(() => ({ ...state, refreshProfile }), [state, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
