import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

// The route-change entrance, mounted by each role layout *around its
// <Outlet />* — never around the whole app. Wrapping the router itself would
// remount the sidebar on every navigation, which is precisely the cost R8
// exists to avoid (see BackofficeNav's header comment: the source app's
// single largest performance problem was re-running a whole shell per tab
// switch). Here the shell stays mounted and only the content area animates.
//
// Keyed on `pathname` only, not on the full location: React replays a CSS
// animation when an element is remounted, and a new key is what forces that
// remount. Leaving `search` out of the key is deliberate — the customer order
// screen swaps content via `?orderId=`, and re-running the entrance on every
// such change would flash the page while the user is still reading it.
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div key={pathname} className="animate-page-in">
      {children}
    </div>
  );
}
