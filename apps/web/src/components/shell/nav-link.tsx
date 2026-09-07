import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

// A plain <Link> — not a client-side tab switch. Each destination is a real
// route, lazily imported and code-split in app-routes.tsx, that renders
// independently; this component only adds "which one is active" styling, it
// doesn't own any content-swapping logic itself (see docs/ARCHITECTURE.md — R8).
//
// Keeps `href` as its prop name rather than React Router's `to` so every
// caller (RoleShell, BackofficeNav) and their nav-item arrays stay unchanged.
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
  const { pathname } = useLocation();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  // The outline variant's active state is a soft tint plus a bar pinned to
  // the inline-start edge (`start-0`, so it follows RTL without a flip).
  // In an eleven-item sidebar the bar is what the eye finds first — a tinted
  // pill alone is easy to lose in peripheral vision, and it also lets the
  // idle rows stay borderless instead of every row carrying an outline.
  const activeClasses =
    variant === "outline"
      ? "bg-accent-soft font-semibold text-accent before:absolute before:inset-y-1.5 before:start-0 before:w-[3px] before:rounded-full before:bg-accent"
      : "bg-accent font-medium text-accent-ink shadow-card";

  return (
    <Link
      to={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
        active ? activeClasses : "text-ink-muted hover:bg-canvas hover:text-ink"
      } ${className}`}
    >
      {children}
    </Link>
  );
}
