import { Suspense } from "react";
import { Outlet } from "react-router-dom";

import { BackofficeNav } from "@/components/shell/backoffice-nav";
import { PageTransition } from "@/components/shell/page-transition";

import BackofficeLoading from "./loading";

// The role check that used to run here (`await requireRole("backoffice")`)
// now lives on the parent route in app-routes.tsx, so it is declared once
// for the whole group rather than executed on every render of this layout.
// See lib/require-role.tsx for what that guard does and does not protect.
export default function BackofficeLayout() {
  return (
    <div className="flex min-h-dvh">
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
  );
}
