"use client";

import { useState, type ReactNode } from "react";

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
      {/* Mobile header — hidden until identity has loaded, matching the
          source's "no flash of header without identity" rule. */}
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        {loading ? (
          <Skeleton className="h-8 w-40" />
        ) : (
          <IdentityStrip displayName={profile?.displayName} companyName={profile?.companyName ?? null} />
        )}
        <div className="flex items-center gap-1">
          <AlertsBell />
          <button
            type="button"
            aria-label="תפריט"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-md p-2 text-ink hover:bg-canvas"
          >
            <span aria-hidden className="block text-xl leading-none">
              ☰
            </span>
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="border-b border-border bg-surface px-4 py-3 md:hidden">
          <HamburgerMenuContents
            navItems={navItems}
            primaryAction={primaryAction}
            onNavigate={() => setMenuOpen(false)}
          />
        </div>
      )}

      {/* Desktop floating sidebar — replaces the header entirely on wide
          viewports, per the PRD. */}
      <aside className="hidden w-64 shrink-0 border-e border-border bg-surface p-4 md:flex md:flex-col md:gap-4">
        <p className="text-base font-bold tracking-tight text-accent">אורי והבננות</p>
        <div className="flex items-center justify-between gap-2">
          {loading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <IdentityStrip displayName={profile?.displayName} companyName={profile?.companyName ?? null} />
          )}
          <AlertsBell />
        </div>

        <nav aria-label="ניווט" className="flex flex-1 flex-col gap-1">
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
        <NavLink
          href={primaryAction.href}
          className="border border-accent bg-accent text-center font-medium text-accent-ink hover:opacity-90"
        >
          {primaryAction.label}
        </NavLink>

        <SignOutButton className="mt-auto text-start" />
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
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden className="h-9 w-9 shrink-0 rounded-full bg-border" />
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
      <NavLink
        href={primaryAction.href}
        className="border border-accent bg-accent text-center font-medium text-accent-ink hover:opacity-90"
      >
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
