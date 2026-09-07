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

// The primary action is the one filled-accent control in the shell, so it
// needs `justify-center` to override NavLink's leading-icon flex alignment
// and read as a button rather than as another nav row.
const PRIMARY_ACTION_CLASSES =
  "justify-center bg-accent font-semibold text-accent-ink shadow-card hover:bg-accent-hover hover:text-accent-ink";

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
          form the alerts bell stays reachable without scrolling back up. */}
      <div className="sticky top-0 z-30 border-b border-border bg-surface shadow-card md:hidden">
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
              className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              <Icon name={menuOpen ? "close" : "menu"} />
            </button>
          </div>
        </header>

        {menuOpen && (
          <div className="border-t border-border px-3 py-3">
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
      <aside className="hidden w-64 shrink-0 border-e border-border bg-surface p-4 md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:gap-4">
        <div className="flex items-center gap-2">
          {/* Letter mark rather than an icon-set glyph — see BackofficeNav. */}
          <span
            aria-hidden
            className="flex h-7 w-7 select-none items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-ink"
          >
            א
          </span>
          <p className="text-base font-bold tracking-tight text-ink">אורי והבננות</p>
        </div>

        <div className="flex items-center justify-between gap-2 border-y border-border py-3">
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

        <nav aria-label="ניווט" className="flex flex-col gap-0.5">
          {navItems.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* The enable-condition for this button (today's pick/order must
            already exist) is real product logic that lands with the
            grower/customer domain modules — this shell only wires the
            control itself, per this prompt's "no product logic yet" scope. */}
        <NavLink href={primaryAction.href} className={PRIMARY_ACTION_CLASSES}>
          {primaryAction.label}
        </NavLink>

        <SignOutButton className="mt-auto self-start" />
      </aside>

      <main className="flex-1 p-4 md:p-6">{children}</main>
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
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent"
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
      <NavLink href={primaryAction.href} className={PRIMARY_ACTION_CLASSES}>
        {primaryAction.label}
      </NavLink>
      {navItems.map((item) => (
        <NavLink key={item.href} href={item.href}>
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}
