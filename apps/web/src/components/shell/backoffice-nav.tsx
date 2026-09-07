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
  { href: "/backoffice/arrangement", label: "סידור", icon: "clipboard" },
  { href: "/backoffice/new-arrangement", label: "סידור חדש", icon: "plusCircle" },
  { href: "/backoffice/order-history", label: "היסטוריית הזמנות", icon: "clock" },
];

const SYSTEM_NAV: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/backoffice/products", label: "מוצרים", icon: "package" },
  { href: "/backoffice/growers", label: "מגדלים", icon: "sprout" },
  { href: "/backoffice/customers", label: "לקוחות", icon: "users" },
  { href: "/backoffice/transporters", label: "מובילים", icon: "truck" },
  { href: "/backoffice/users", label: "משתמשים", icon: "user" },
  { href: "/backoffice/distributor-grower", label: "בשם מגדל", icon: "leaf" },
  { href: "/backoffice/distributor-customer", label: "בשם לקוח", icon: "briefcase" },
];

// The icon leads the row (inline-start, so the right in RTL) and the label
// follows. Previously the icon trailed at the far edge with the label pushed
// away from it, which left the eleven rows with no common vertical line to
// scan down — the icons now form that line.
function BackofficeNavLink({ href, label, icon }: { href: string; label: string; icon: IconName }) {
  return (
    <NavLink href={href} variant="outline">
      <Icon name={icon} className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

// Reads identity the same way RoleShell does (useAuth(), backed by
// onAuthStateChange) — one client-side pattern for "who's signed in and
// what do we call them," not a second one specific to Backoffice.
export function BackofficeNav() {
  const { profile, loading } = useAuth();

  return (
    // Pinned to the viewport instead of stretching with the page: with
    // `h-full` a long screen (the products table, order history) dragged the
    // sidebar down with it, so the nav — and the day-lifecycle controls
    // inside it — scrolled out of reach. Now the rail owns the viewport
    // height and its own middle section is what scrolls.
    <nav
      aria-label="ניווט מערכת"
      className="sticky top-0 flex h-dvh w-64 shrink-0 flex-col border-e border-border bg-surface"
    >
      <div className="border-b border-border px-4 py-4">
        <div className="mb-3 flex items-center gap-2">
          {/* A letter mark, not a glyph from the icon set: every icon in that
              set is spoken for by a nav row, and reusing one for the brand
              made the logo read as a twelfth destination. */}
          <span
            aria-hidden
            className="flex h-7 w-7 select-none items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-ink"
          >
            א
          </span>
          <p className="text-base font-bold tracking-tight text-ink">אורי והבננות</p>
        </div>
        <div className="flex items-center justify-between gap-2">
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
          <AlertsBell />
        </div>
      </div>

      <BusinessDayPanel />

      <div className="flex-1 space-y-5 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {OPERATIONAL_NAV.map((item) => (
            <li key={item.href}>
              <BackofficeNavLink {...item} />
            </li>
          ))}
        </ul>

        <div>
          <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-ink-subtle">
            ניהול מערכת
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

      <div className="border-t border-border px-4 py-3">
        <SignOutButton variant="solid" />
      </div>
    </nav>
  );
}
