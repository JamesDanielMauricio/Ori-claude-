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
  // only by BackofficeNav. "primary" is the shells' one call-to-action row
  // (RoleShell's `primaryAction`), which is solid accent whether or not it
  // is the current route.
  //
  // "primary" exists because the previous approach — a filled NavLink plus a
  // PRIMARY_ACTION_CLASSES string appended to `className` — produced an
  // unreadable button on any screen where that route was NOT active: the
  // idle state's `text-ink-muted` and the override's `text-accent-ink` are
  // both single-class utilities of equal specificity, so which one wins is
  // decided by their order in Tailwind's generated sheet, not by the order
  // they are concatenated here. Muted green on solid green was the result.
  // Encoding the intent as a variant removes the collision entirely rather
  // than betting on emit order or reaching for `!important`.
  variant?: "filled" | "outline" | "primary";
}) {
  const { pathname } = useLocation();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  // The outline variant's active state is a soft tint plus a bar pinned to
  // the inline-start edge (`start-0`, so it follows RTL without a flip).
  // In an eleven-item sidebar the bar is what the eye finds first — a tinted
  // pill alone is easy to lose in peripheral vision, and it also lets the
  // idle rows stay borderless instead of every row carrying an outline.
  //
  // The bar is drawn with `scale-y` on a pseudo-element so it grows from the
  // row's centre when the route becomes active, instead of appearing at full
  // height instantly. `transform-origin: center` plus `transition` on the
  // pseudo-element means the idle→active handoff is animated in both
  // directions without any JS tracking which row was previously selected.
  // The bar defaults to hidden in the base class below and is only switched
  // on for the outline variant's active row. The filled variant never shows
  // it: its active state is already a solid accent fill, so a bar of the same
  // color would be invisible there and — worse — would be plainly visible on
  // its *idle* rows, which is the opposite of what it means.
  // The call-to-action row looks the same in both states, so there is nothing
  // to branch on — it only ever darkens on hover.
  const PRIMARY_CLASSES =
    "justify-center bg-accent font-semibold text-accent-ink shadow-accent shadow-[inset_0_1px_0_0_rgb(255_255_255/0.16)] hover:bg-accent-hover";

  const activeClasses =
    variant === "outline"
      ? "bg-accent-soft font-semibold text-accent before:scale-y-100 before:opacity-100"
      : "bg-accent font-semibold text-accent-ink shadow-accent";

  const idleClasses =
    variant === "outline"
      ? "text-ink-muted hover:bg-accent-soft/50 hover:text-accent"
      : "text-ink-muted hover:bg-accent-soft/60 hover:text-accent";

  const stateClasses =
    variant === "primary" ? PRIMARY_CLASSES : active ? activeClasses : idleClasses;

  return (
    <Link
      to={href}
      aria-current={active ? "page" : undefined}
      // `translate-x`-free hover on purpose: nudging a nav row sideways on
      // hover makes an eleven-item rail feel unstable when the pointer
      // crosses it on the way somewhere else. The tint alone is the signal.
      className={`group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-[background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)] before:absolute before:inset-y-1.5 before:start-0 before:w-[3px] before:scale-y-0 before:rounded-full before:bg-accent before:opacity-0 before:transition-[transform,opacity] before:duration-200 before:content-[''] ${stateClasses} ${className}`}
    >
      {children}
    </Link>
  );
}
