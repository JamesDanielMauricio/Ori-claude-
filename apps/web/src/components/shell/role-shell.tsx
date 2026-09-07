import { useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";

import { AlertsBell } from "./alerts-bell";
import { NavLink } from "./nav-link";
import { SignOutButton } from "./sign-out-button";
import { Skeleton } from "../ui/skeleton";

export interface RoleShellNavItem {
  href: string;
  label: string;
}

export interface RoleShellProps {
  navItems: RoleShellNavItem[];
  primaryAction: RoleShellNavItem;
  children: ReactNode;
}

// The primary action's appearance now lives in NavLink's `primary` variant
// rather than in an override string appended here. Concatenating utilities
// onto a component that already sets the same properties only works when the
// generated stylesheet happens to order them favorably — and it did not: on
// any screen where this route was not the active one, the idle state's
// `text-ink-muted` beat the override's `text-accent-ink` and the button
// rendered muted green on solid green. See NavLink's `variant` comment.

// The single component both Grower Home and Customer Home mount — per the
// PRD, the two roles see the identical header + floating-sidebar shape;
// only labels (passed in via `navItems`/`primaryAction`) differ. Rebuilt,
// not ported: the source's header/sidebar pair is reproduced here as one
// shared component with two responsive presentations (a top strip + hamburger
// overlay on narrow viewports, a persistent floating sidebar on wide ones),
// exactly like the source, but as real CSS breakpoints instead of
// duplicated Bubble element trees.
export function RoleShell({ navItems, primaryAction, children }: RoleShellProps) {
  const { profile, loading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Header and the menu it opens are one sticky unit, so the menu can't
          scroll away from the button that opened it — and on a long order
          form the alerts bell stays reachable without scrolling back up.
          Translucent + blurred rather than solid: content scrolling beneath
          stays faintly readable through it, which keeps the page feeling
          continuous instead of clipped at a hard edge. */}
      <div
        data-surface="rail"
        className="sticky top-0 z-30 bg-surface text-ink shadow-raised md:hidden"
      >
        {/* Hidden until identity has loaded, matching the source's "no flash
            of header without identity" rule. */}
        <header className="flex items-center justify-between px-4 py-2.5">
          {loading ? (
            <Skeleton className="h-9 w-40" />
          ) : (
            <IdentityStrip
              displayName={profile?.displayName}
              companyName={profile?.companyName ?? null}
            />
          )}
          <div className="flex items-center gap-0.5">
            <AlertsBell />
            <button
              type="button"
              aria-label="תפריט"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-[background-color,color,transform] duration-200 hover:bg-accent-soft hover:text-accent active:scale-95"
            >
              <Icon name={menuOpen ? "close" : "menu"} />
            </button>
          </div>
        </header>

        {menuOpen && (
          <div className="animate-rise-in border-t border-border px-3 py-3">
            <HamburgerMenuContents
              navItems={navItems}
              primaryAction={primaryAction}
              onNavigate={() => setMenuOpen(false)}
            />
          </div>
        )}
      </div>

      {/* Desktop floating sidebar — replaces the header entirely on wide
          viewports, per the PRD. Pinned to the viewport so it stays put
          while a long list scrolls beside it. */}
      <aside
        // Same dark-rail token switch as BackofficeNav — see globals.css.
        data-surface="rail"
        className="hidden w-64 shrink-0 bg-surface p-5 text-ink md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:gap-5"
      >
        <div className="flex items-center gap-2.5">
          {/* Letter mark rather than an icon-set glyph — see BackofficeNav. */}
          <span
            aria-hidden
            className="font-display flex h-9 w-9 select-none items-center justify-center rounded-lg text-lg text-brass ring-1 ring-inset ring-brass/40"
          >
            א
          </span>
          <p className="font-display text-lg text-ink">אורי והבננות</p>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2.5 ring-1 ring-inset ring-border">
          {loading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <IdentityStrip
              displayName={profile?.displayName}
              companyName={profile?.companyName ?? null}
            />
          )}
          <AlertsBell />
        </div>

        {/* `outline` rather than the solid `filled` active state these rows
            used to have. The shells' primary action is itself a solid green
            row, and on the customer shell it points at the same route as the
            first nav item — so with both solid, the sidebar showed two
            identical green "הזמנה" buttons stacked on top of each other. Only
            the call to action is solid now; the current page is marked with a
            soft tint and an edge bar, exactly as in the backoffice rail. */}
        <nav aria-label="ניווט" className="flex flex-col gap-0.5">
          {navItems.map((item) => (
            <NavLink key={item.href} href={item.href} variant="outline">
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* The enable-condition for this button (today's pick/order must
            already exist) is real product logic that lands with the
            grower/customer domain modules — this shell only wires the
            control itself, per this prompt's "no product logic yet" scope. */}
        <NavLink href={primaryAction.href} variant="primary">
          {primaryAction.label}
        </NavLink>

        <SignOutButton className="mt-auto self-start" />
      </aside>

      {/* More generous than the previous p-6. Space is most of what separates
          a premium layout from a dense one, and the content column here is
          rarely wide enough to need the extra pixels for data. */}
      <main className="min-w-0 flex-1 p-5 md:p-8 lg:p-10">{children}</main>
    </div>
  );
}

function IdentityStrip({
  displayName,
  companyName,
}: {
  displayName: string | undefined;
  companyName: string | null;
}) {
  // Initials instead of an empty gray disc. The circle was already there as
  // a placeholder for an avatar the app has no image source for, so it may
  // as well carry the one identifying thing we do have.
  const initial = displayName?.trim().charAt(0) ?? "";

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div
        aria-hidden
        className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-base text-accent ring-1 ring-inset ring-accent/25"
      >
        {initial}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{displayName ?? ""}</p>
        {companyName && <p className="truncate text-xs text-ink-muted">{companyName}</p>}
      </div>
    </div>
  );
}

function HamburgerMenuContents({
  navItems,
  primaryAction,
  onNavigate,
}: {
  navItems: RoleShellNavItem[];
  primaryAction: RoleShellNavItem;
  onNavigate: () => void;
}) {
  return (
    <div className="flex flex-col gap-1" onClick={onNavigate}>
      <NavLink href={primaryAction.href} variant="primary">
        {primaryAction.label}
      </NavLink>
      {navItems.map((item) => (
        <NavLink key={item.href} href={item.href} variant="outline">
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}
