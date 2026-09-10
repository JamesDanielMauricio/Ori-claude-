import { Suspense } from "react";
import { Outlet } from "react-router-dom";

import { PageTransition } from "@/components/shell/page-transition";
import { RoleShell } from "@/components/shell/role-shell";

const GROWER_NAV = [
  { href: "/grower/picks", label: "עדכון יומי" },
  { href: "/grower/history", label: "היסטוריית ליקוט" },
];

// `await requireRole("grower")` moved to the parent route in
// app-routes.tsx — see lib/require-role.tsx.
export default function GrowerLayout() {
  return (
    <RoleShell navItems={GROWER_NAV}>
      {/* Inside the shell, so switching screens keeps the sidebar mounted. */}
      <Suspense fallback={null}>
        <PageTransition>
          <Outlet />
        </PageTransition>
      </Suspense>
    </RoleShell>
  );
}
