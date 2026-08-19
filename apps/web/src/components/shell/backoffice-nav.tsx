"use client";

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
// for the reference/admin screens. Icons are emoji, matching the precedent
// already set by AlertsBell's 🔔 — no icon library dependency added just
// for this.
const OPERATIONAL_NAV: Array<{ href: string; label: string; icon: string }> = [
  { href: "/backoffice/shop", label: "ניהול חנות", icon: "🛒" },
  { href: "/backoffice/arrangement", label: "סידור", icon: "📋" },
  { href: "/backoffice/new-arrangement", label: "סידור חדש", icon: "➕" },
  { href: "/backoffice/order-history", label: "היסטוריית הזמנות", icon: "🕘" },
];

const SYSTEM_NAV: Array<{ href: string; label: string; icon: string }> = [
  { href: "/backoffice/products", label: "מוצרים", icon: "📦" },
  { href: "/backoffice/growers", label: "מגדלים", icon: "🌱" },
  { href: "/backoffice/customers", label: "לקוחות", icon: "👥" },
  { href: "/backoffice/transporters", label: "מובילים", icon: "🚚" },
  { href: "/backoffice/users", label: "משתמשים", icon: "👤" },
  { href: "/backoffice/distributor-grower", label: "בשם מגדל", icon: "🧑‍🌾" },
  { href: "/backoffice/distributor-customer", label: "בשם לקוח", icon: "🧑‍💼" },
];

function BackofficeNavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <NavLink href={href} variant="outline">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span aria-hidden className="text-base leading-none opacity-70">
          {icon}
        </span>
      </span>
    </NavLink>
  );
}

// Reads identity the same way RoleShell does (useAuth(), backed by
// onAuthStateChange) — one client-side pattern for "who's signed in and
// what do we call them," not a second one specific to Backoffice.
export function BackofficeNav() {
  const { profile, loading } = useAuth();

  return (
    <nav
      aria-label="ניווט מערכת"
      className="flex h-full w-64 shrink-0 flex-col border-e border-border bg-surface"
    >
      <div className="border-b border-border px-4 py-4">
        <p className="mb-3 text-base font-bold tracking-tight text-accent">אורי והבננות</p>
        <div className="flex items-center justify-between gap-2">
          {loading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{profile?.displayName}</p>
              {profile?.companyName && <p className="truncate text-xs text-ink-muted">{profile.companyName}</p>}
            </div>
          )}
          <AlertsBell />
        </div>
      </div>

      <BusinessDayPanel />

      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        <ul className="space-y-1">
          {OPERATIONAL_NAV.map((item) => (
            <li key={item.href}>
              <BackofficeNavLink {...item} />
            </li>
          ))}
        </ul>

        <div>
          <p className="px-3 pb-1 text-xs font-semibold text-ink-muted">ניהול מערכת</p>
          <ul className="space-y-1">
            {SYSTEM_NAV.map((item) => (
              <li key={item.href}>
                <BackofficeNavLink {...item} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-border px-4 py-3">
        <SignOutButton variant="solid" />
      </div>
    </nav>
  );
}
