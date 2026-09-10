import { useState } from "react";

import { Icon, type IconName } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";

import { AlertsBell } from "./alerts-bell";
import { BusinessDayPanel } from "./business-day-panel";
import { NavLink } from "./nav-link";
import { SignOutButton } from "./sign-out-button";
import { Skeleton } from "../ui/skeleton";

// The `side_bar_v2` equivalent — rebuilt, not ported. The source mounted
// all eleven of these as tabs inside one page; switching between them was
// the single largest documented performance problem in the app (a full
// condition sweep across 142 elements and up to 16 nested repeating groups
// per tab switch — see the "Performance Issues" findings, Issue 2). Here
// each row is a real route: this sidebar lives in the route group's layout
// and therefore never remounts on navigation, while each destination is
// its own page that fetches only its own data. That combination is the
// fix, not a CSS tweak — R8.
// Split into the same two visual groups as the source sidebar: day-to-day
// operational screens with no heading, then a labelled "ניהול מערכת" group
// for the reference/admin screens.
const OPERATIONAL_NAV: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/backoffice/shop", label: "ניהול חנות", icon: "cart" },
  // Acting on behalf of a grower/customer sits right before the arrangement
  // screens rather than down in "ניהול מערכת": both are day-to-day work on
  // TODAY's picking and ordering, not reference-data upkeep, and they are
  // literally the two inputs "סידור" matches against — so a distributor
  // chasing a grower's missing pallets or a customer's stalled order finds
  // that one click above the screen where the mismatch actually shows up.
  { href: "/backoffice/distributor-grower", label: "בשם מגדל", icon: "leaf" },
  { href: "/backoffice/distributor-customer", label: "בשם לקוח", icon: "briefcase" },
  // The same day, two ways round. "סידור" is the board — one grower's lot at
  // a time, worked down the customer list. "סידור לפי מוצרים" is the grid —
  // every product against every customer at once. Named for what each is
  // organised BY, because that is the only thing that decides which one a
  // distributor wants; the route is still /new-arrangement, where the
  // one-record-at-a-time wizard the grid replaced used to live.
  { href: "/backoffice/arrangement", label: "סידור", icon: "clipboard" },
  { href: "/backoffice/new-arrangement", label: "סידור לפי מוצרים", icon: "package" },
  { href: "/backoffice/order-history", label: "היסטוריית הזמנות", icon: "clock" },
];

const SYSTEM_NAV: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/backoffice/products", label: "מוצרים", icon: "package" },
  { href: "/backoffice/growers", label: "מגדלים", icon: "sprout" },
  { href: "/backoffice/customers", label: "לקוחות", icon: "users" },
  { href: "/backoffice/transporters", label: "מובילים", icon: "truck" },
  { href: "/backoffice/users", label: "משתמשים", icon: "user" },
];

// The icon leads the row (inline-start, so the right in RTL) and the label
// follows. Previously the icon trailed at the far edge with the label pushed
// away from it, which left the eleven rows with no common vertical line to
// scan down — the icons now form that line.
function BackofficeNavLink({ href, label, icon }: { href: string; label: string; icon: IconName }) {
  return (
    <NavLink href={href} variant="outline">
      {/* The icon scales up a hair on hover. It's a 2px change on an 18px
          glyph — not readable as movement, but enough that the row feels
          responsive under the pointer rather than merely tinted. */}
      <Icon
        name={icon}
        className="h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110"
      />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

// The brand lockup. A letter mark, not a glyph from the icon set: every
// icon in that set is spoken for by a nav row, and reusing one for the brand
// made the logo read as a twelfth destination. Set in the display serif and
// outlined in brass rather than filled in accent green — on the dark rail a
// solid green chip competed with the active nav row, which is the one thing
// here that should be green.
function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="font-display flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-lg text-lg text-brass ring-1 ring-inset ring-brass/40"
      >
        א
      </span>
      <p className="font-display truncate text-lg text-ink">אורי והבננות</p>
    </div>
  );
}

// The identity block is boxed rather than bare, so "who am I signed in as"
// reads as a distinct object from the brand above it and the day controls
// below — three unrelated things that were previously three undifferentiated
// rows of text.
//
// `bell` is opt-out because the narrow presentation puts AlertsBell in its
// header bar instead, where it stays reachable without opening the menu.
function IdentityBlock({ bell = true }: { bell?: boolean }) {
  const { profile, loading } = useAuth();

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2.5 ring-1 ring-inset ring-border">
      {loading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{profile?.displayName}</p>
          {profile?.companyName && (
            <p className="truncate text-xs text-ink-muted">{profile.companyName}</p>
          )}
        </div>
      )}
      {bell && <AlertsBell />}
    </div>
  );
}

// The eleven destinations, in their two groups. Shared verbatim by both
// presentations so a new screen is added in one place.
function NavGroups() {
  return (
    <div className="space-y-6">
      <ul className="space-y-0.5">
        {OPERATIONAL_NAV.map((item) => (
          <li key={item.href}>
            <BackofficeNavLink {...item} />
          </li>
        ))}
      </ul>

      <div>
        {/* The group label gets a hairline rule trailing off to the inline
            end, so it separates the two nav groups on its own instead of
            needing a full divider row above it. */}
        <p className="mb-2 flex items-center gap-2.5 px-3 text-[11px] font-semibold tracking-[0.08em] text-ink-subtle">
          <span className="shrink-0">ניהול מערכת</span>
          <span aria-hidden className="h-px flex-1 bg-border" />
        </p>
        <ul className="space-y-0.5">
          {SYSTEM_NAV.map((item) => (
            <li key={item.href}>
              <BackofficeNavLink {...item} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Reads identity the same way RoleShell does (useAuth(), backed by
// onAuthStateChange) — one client-side pattern for "who's signed in and
// what do we call them," not a second one specific to Backoffice.
//
// Two presentations, the same split RoleShell already draws for the grower
// and customer shells: a top strip with a hamburger below `md`, the
// persistent rail above it. The rail is a fixed `w-64`, so on a ~400px phone
// it took roughly 60% of the screen and left the content column near 150px
// wide — every backoffice screen was technically reachable and none of them
// were usable. Nothing here is desktop-only by intent (the PRD never says
// so), and the two oversight screens in particular — "בשם מגדל" and "בשם
// לקוח" — are exactly what a distributor reaches for while away from a desk.
export function BackofficeNav() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/* Narrow viewports. Header and the menu it opens are one sticky unit,
          so the menu can't scroll away from the button that opened it. */}
      <div
        data-surface="rail"
        className="sticky top-0 z-30 bg-surface text-ink shadow-raised md:hidden"
      >
        <header className="flex items-center justify-between gap-2 px-4 py-2.5">
          <BrandMark />
          <div className="flex shrink-0 items-center gap-0.5">
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

        {/* Mounted only while open, which also keeps BusinessDayPanel — a
            component with real lifecycle mutations behind it — from running a
            second copy of itself on every backoffice screen.
            Capped and scrollable: eleven rows plus the day panel is taller
            than a phone, and a menu that pushes its own sign-out button off
            the bottom of the screen is the one row that has to stay
            reachable. */}
        {menuOpen && (
          <div className="animate-rise-in max-h-[75dvh] overflow-y-auto border-t border-border px-3 py-3">
            <div className="mb-3">
              <IdentityBlock bell={false} />
            </div>

            {/* Bleeds past the menu's own padding so the panel keeps the
                full-width banding it has in the rail. */}
            <div className="-mx-3 mb-3">
              <BusinessDayPanel />
            </div>

            <nav aria-label="ניווט מערכת" onClick={() => setMenuOpen(false)}>
              <NavGroups />
            </nav>

            <div className="mt-3 border-t border-border pt-3">
              <SignOutButton variant="solid" />
            </div>
          </div>
        )}
      </div>

      <DesktopRail />
    </>
  );
}

function DesktopRail() {
  return (
    // Pinned to the viewport instead of stretching with the page: with
    // `h-full` a long screen (the products table, order history) dragged the
    // sidebar down with it, so the nav — and the day-lifecycle controls
    // inside it — scrolled out of reach. Now the rail owns the viewport
    // height and its own middle section is what scrolls.
    <nav
      aria-label="ניווט מערכת"
      // `data-surface="rail"` re-points the color tokens to the dark palette
      // for this whole subtree (see globals.css). Everything below — the day
      // panel's buttons, the alerts bell, sign-out, the nav rows — picks that
      // up without knowing anything about it.
      data-surface="rail"
      className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-surface text-ink md:flex"
    >
      <div className="px-5 pb-4 pt-5">
        <div className="mb-4">
          <BrandMark />
        </div>
        <IdentityBlock />
      </div>

      <BusinessDayPanel />

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <NavGroups />
      </div>

      <div className="border-t border-border px-5 py-4">
        <SignOutButton variant="solid" />
      </div>
    </nav>
  );
}
