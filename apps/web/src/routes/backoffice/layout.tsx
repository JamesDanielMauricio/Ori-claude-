import { Suspense } from "react";
import { Outlet } from "react-router-dom";

import { BackofficeNav } from "@/components/shell/backoffice-nav";
import { PageTransition } from "@/components/shell/page-transition";
import { SelectedTradingDayProvider } from "@/lib/trading-day-view";

import BackofficeLoading from "./loading";

// The role check that used to run here (`await requireRole("backoffice")`)
// now lives on the parent route in app-routes.tsx, so it is declared once
// for the whole group rather than executed on every render of this layout.
// See lib/require-role.tsx for what that guard does and does not protect.
export default function BackofficeLayout() {
  return (
    // Wraps BOTH the nav (whose BusinessDayPanel holds the date picker) and
    // the routed page (whichever of the date-aware screens is mounted) in
    // one provider, so the picked date survives navigating from one
    // backoffice screen to another instead of resetting to live on every
    // click — see lib/trading-day-view.tsx.
    <SelectedTradingDayProvider>
      {/* Column below `md`, row above it — BackofficeNav renders a sticky top
          strip on narrow viewports and the persistent rail on wide ones, and
          the two have to stack differently. Same shape RoleShell's own
          wrapper uses. */}
      <div className="flex min-h-dvh flex-col md:flex-row">
        <BackofficeNav />
        <main className="min-w-0 flex-1 overflow-x-hidden p-5 md:p-8 lg:p-10">
          {/* Suspense sits inside <main>, not around the whole layout, so a
              sidebar click swaps only the content area and leaves the nav
              mounted — the same boundary app/(backoffice)/loading.tsx drew. */}
          <Suspense fallback={<BackofficeLoading />}>
            <PageTransition>
              <Outlet />
            </PageTransition>
          </Suspense>
        </main>
      </div>
    </SelectedTradingDayProvider>
  );
}
