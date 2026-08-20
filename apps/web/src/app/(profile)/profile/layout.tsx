import type { ReactNode } from "react";

import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { requireSession } from "@/lib/auth-guard";

const ROLE_HOME: Record<string, string> = {
  backoffice: "/backoffice",
  grower: "/grower",
  customer: "/customer",
};

// Per the PRD, User Profile isn't scoped to any one role's routed area —
// any authenticated user can reach it — so it gets `requireSession()`
// (auth only) rather than the `requireRole()` each role group uses, and a
// minimal chrome of its own instead of borrowing one role's shell.
export default async function ProfileLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-6">
      <Link
        href={ROLE_HOME[user.role] ?? "/"}
        className="inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        <Icon name="chevronStart" className="h-4 w-4" />
        חזרה
      </Link>
      {children}
    </div>
  );
}
