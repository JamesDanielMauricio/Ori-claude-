import { Suspense } from "react";
import { Outlet } from "react-router-dom";

import { PageTransition } from "@/components/shell/page-transition";
import { RoleShell } from "@/components/shell/role-shell";

const CUSTOMER_NAV = [
  { href: "/customer/order", label: "הזמנה" },
  { href: "/customer/history", label: "היסטוריית הזמנות" },
];

// `await requireRole("customer")` moved to the parent route in
// app-routes.tsx — see lib/require-role.tsx.
export default function CustomerLayout() {
  return (
    <RoleShell navItems={CUSTOMER_NAV} primaryAction={{ href: "/customer/order", label: "הזמנה" }}>
      {/* Inside the shell, so switching screens keeps the sidebar mounted. */}
      <Suspense fallback={null}>
        <PageTransition>
          <Outlet />
        </PageTransition>
      </Suspense>
    </RoleShell>
  );
}
