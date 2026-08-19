import type { ReactNode } from "react";

import { BackofficeNav } from "@/components/shell/backoffice-nav";
import { requireRole } from "@/lib/auth-guard";

export default async function BackofficeLayout({ children }: { children: ReactNode }) {
  await requireRole("backoffice");

  return (
    <div className="flex min-h-dvh">
      <BackofficeNav />
      <main className="flex-1 overflow-x-hidden p-6">{children}</main>
    </div>
  );
}
