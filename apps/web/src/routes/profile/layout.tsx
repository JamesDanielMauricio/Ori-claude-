import { resolveHomeRoute } from "@ori/shared/roles";
import { Suspense } from "react";
import { Link, Outlet } from "react-router-dom";

import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";

// Per the PRD, User Profile isn't scoped to any one role's routed area —
// any authenticated user can reach it — so the guard on this route in
// app-routes.tsx is RequireAuth with no `role` (the old requireSession()),
// and it keeps a minimal chrome of its own instead of borrowing one role's
// shell.
//
// The "back" target is resolved with @ori/shared's resolveHomeRoute rather
// than a local role → route map, so there's one such map in the codebase
// (R5) instead of a copy here.
export default function ProfileLayout() {
  const { profile } = useAuth();

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-6">
      <Link
        to={profile ? resolveHomeRoute(profile.role) : "/"}
        className="inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        <Icon name="chevronStart" className="h-4 w-4" />
        חזרה
      </Link>
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </div>
  );
}
