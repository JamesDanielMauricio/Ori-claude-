import { resolveHomeRoute } from "@ori/shared/roles";
import { Navigate } from "react-router-dom";

import { useAuth } from "@/lib/auth-context";

// The single entry point that decides where a signed-in user lands —
// downstream, each role's own route group (via RequireAuth) is still the
// actual gate; this just avoids showing an empty root page.
//
// Uses resolveHomeRoute() from @ori/shared rather than a local role → route
// map: that helper is the one centralized resolver every entry point calls
// (R5), and the sign-in form already routes through it.
export function HomeRedirect() {
  const { user, profile, loading } = useAuth();

  // Render nothing rather than a skeleton: this route never shows a screen
  // of its own, it only decides where to send you. A flash of loading
  // scaffolding here would be scaffolding for a page that doesn't exist.
  if (loading) {
    return null;
  }

  if (!user || !profile) {
    return <Navigate to="/login" replace />;
  }

  if (profile.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return <Navigate to={resolveHomeRoute(profile.role)} replace />;
}
