"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// A plain <Link> — not a client-side tab switch. Each destination is a real
// route Next.js code-splits and renders independently; this component only
// adds "which one is active" styling, it doesn't own any content-swapping
// logic itself (see docs/ARCHITECTURE.md — R8).
export function NavLink({
  href,
  children,
  className = "",
  variant = "filled",
}: {
  href: string;
  children: ReactNode;
  className?: string;
  // "filled" is the original solid-accent active state every existing
  // caller (RoleShell) still relies on. "outline" is additive, opted into
  // only by BackofficeNav, so this stays a no-op for every other caller.
  variant?: "filled" | "outline";
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  const activeClasses =
    variant === "outline" ? "border border-accent bg-accent-soft font-medium text-accent" : "bg-accent text-accent-ink";

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md border border-transparent px-3 py-2 text-sm transition-colors ${
        active ? activeClasses : "text-ink hover:bg-canvas"
      } ${className}`}
    >
      {children}
    </Link>
  );
}
