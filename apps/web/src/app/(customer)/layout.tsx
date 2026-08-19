import type { ReactNode } from "react";

import { RoleShell } from "@/components/shell/role-shell";
import { requireRole } from "@/lib/auth-guard";

const CUSTOMER_NAV = [
  { href: "/customer/order", label: "הזמנה" },
  { href: "/customer/history", label: "היסטוריית הזמנות" },
];

export default async function CustomerLayout({ children }: { children: ReactNode }) {
  await requireRole("customer");

  return (
    <RoleShell navItems={CUSTOMER_NAV} primaryAction={{ href: "/customer/order", label: "הזמנה" }}>
      {children}
    </RoleShell>
  );
}
