import type { ReactNode } from "react";

import { BackofficeNav } from "@/components/shell/backoffice-nav";
import { requireRole } from "@/lib/auth-guard";

export default async function BackofficeLayout({ children }: { children: ReactNode }) {
  await requireRole("backoffice");

  return (
    <div className="flex min-h-dvh">
      <BackofficeNav />
      <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-6">{children}</main>
    </div>
  );
}
