import { useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";

import { AlertsBell } from "./alerts-bell";
import { NavLink } from "./nav-link";
import { SettingsTogglesButton } from "./settings-toggles-button";
import { SignOutButton } from "./sign-out-button";
import { Skeleton } from "../ui/skeleton";

export interface RoleShellNavItem {
  href: string;
  label: string;
}

export interface RoleShellProps {
  navItems: RoleShellNavItem[];
  children: ReactNode;
}

// The single component both Grower Home and Customer Home mount — per the
// PRD, the two roles see the identical header + floating-sidebar shape;
// only labels (passed in via `navItems`) differ. Rebuilt, not ported: the
// source's header/sidebar pair is reproduced here as one shared component
// with two responsive presentations (a top strip + hamburger overlay on
// narrow viewports, a persistent floating sidebar on wide ones), exactly
// like the source, but as real CSS breakpoints instead of duplicated Bubble
// element trees.
//
// Used to also take a `primaryAction` — a second, solid-accent NavLink
// rendered above the list, e.g. "הזמנה" on the customer shell and "עדכון" on
// the grower shell. Removed: on both shells it pointed at the exact route
// the first item in `navItems` already does, so it was a second button for
// a destination already one click away.
export function RoleShell({ navItems, children }: RoleShellProps) {
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
              // 40px, matching the AlertsBell beside it — it was 36, the one
              // control in the phone header under the touch-target floor, and
              // it is the only way into navigation on that layout. The header
              // row was already 40px tall because of the bell, so this costs
              // no height.
              className="flex h-10 w-10 items-center justify-center rounded-md text-ink-muted transition-[background-color,color,transform] duration-200 hover:bg-accent-soft hover:text-accent active:scale-95"
            >
              <Icon name={menuOpen ? "close" : "menu"} />
            </button>
          </div>
        </header>

        {menuOpen && (
          <div className="animate-rise-in border-t border-border px-3 py-3">
            <HamburgerMenuContents navItems={navItems} onNavigate={() => setMenuOpen(false)} />
          </div>
        )}
      </div>

      {/* Desktop floating sidebar — replaces the header entirely on wide
          viewports, per the PRD. Pinned to the viewport so it stays put
          while a long list scrolls beside it. */}
      <aside
        // Same sidebar palette switch as BackofficeNav — see globals.css.
        data-surface="rail"
        // `border-e`: a hairline on the edge that faces the content. In both
        // themes the sidebar and the page are only one step apart in lightness
        // (white beside off-white, near-black beside charcoal), so this line
        // is what divides them.
        className="hidden w-64 shrink-0 border-e border-border bg-surface p-5 text-ink md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:gap-5"
      >
        <div className="flex items-center gap-2.5">
          {/* Letter mark rather than an icon-set glyph — see BackofficeNav. */}
          <span
            aria-hidden
            className="flex h-9 w-9 select-none items-center justify-center rounded-lg text-sm font-semibold text-accent ring-1 ring-inset ring-accent/40"
          >
            א
          </span>
          <p className="text-sm font-semibold text-ink">אורי והבננות</p>
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
            used to have — matches the current page's treatment in the
            backoffice rail: a soft tint plus an edge bar rather than a solid
            fill, so an active row doesn't compete with the sign-out button
            below for "loudest thing in the sidebar". */}
        <nav aria-label="ניווט" className="flex flex-col gap-0.5">
          {navItems.map((item) => (
            <NavLink key={item.href} href={item.href} variant="outline">
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* `solid` — the bordered, filled treatment — rather than the bare
            text link this used to be. It was easy to miss sitting under a
            wall of nav rows, and on mobile it was missing outright (see
            HamburgerMenuContents below), so the desktop and mobile versions
            now match. It shares the bottom with system settings: both act
            on this browser/account rather than taking you anywhere, so
            neither belongs among the nav rows. */}
        <div className="mt-auto flex flex-col gap-3">
          <SettingsTogglesButton />
          <SignOutButton variant="solid" />
        </div>
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
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent ring-1 ring-inset ring-accent/25"
      >
        {initial}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{displayName ?? ""}</p>
        {/* Wraps to a second line instead of truncating. In the desktop
            sidebar this line gets 97px — the rail is w-64, and the avatar,
            the bell and their gaps take the rest — which cut a real company
            name ("א.ש. שמאי סחר ושיווק בע\"מ", 123px) mid-word. Two lines
            fit it whole. Still capped, so a long name can't push the nav
            down the rail; `break-words` is what stops an unbroken string
            overflowing the box rather than wrapping inside it. The display
            name above keeps `truncate`: it is the identifying line and has
            to stay one row, and it is short enough that it fits. */}
        {companyName && (
          <p className="line-clamp-2 break-words text-xs text-ink-muted">{companyName}</p>
        )}
      </div>
    </div>
  );
}

function HamburgerMenuContents({
  navItems,
  onNavigate,
}: {
  navItems: RoleShellNavItem[];
  onNavigate: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div onClick={onNavigate} className="flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink key={item.href} href={item.href} variant="outline">
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Was missing from this menu entirely — on mobile, customer/grower
          users had no way to sign out at all, since the desktop sidebar's
          copy of this button is hidden below the `md` breakpoint. Kept
          outside the `onNavigate` click handler above: signing out already
          navigates to /login itself, so closing the menu first is redundant
          and would fire a state update on a component about to unmount.
          System settings sits outside it too, so picking a theme inside its
          dialog doesn't close the menu the choice was made in. */}
      <div className="mt-1 flex flex-col gap-2 border-t border-border pt-2">
        <SettingsTogglesButton />
        <SignOutButton variant="solid" />
      </div>
    </div>
  );
}
