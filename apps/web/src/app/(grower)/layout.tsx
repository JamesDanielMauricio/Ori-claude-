import type { ReactNode } from "react";

import { RoleShell } from "@/components/shell/role-shell";
import { requireRole } from "@/lib/auth-guard";

const GROWER_NAV = [
  { href: "/grower/picks", label: "עדכון יומי" },
  { href: "/grower/legacy", label: "מצב מוצרים (ישן)" },
];

export default async function GrowerLayout({ children }: { children: ReactNode }) {
  await requireRole("grower");

  return (
    <RoleShell navItems={GROWER_NAV} primaryAction={{ href: "/grower/picks", label: "עדכון" }}>
      {children}
    </RoleShell>
  );
}
