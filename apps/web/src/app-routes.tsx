import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { HomeRedirect } from "@/routes/home-redirect";
import NotFound from "@/routes/not-found";

import { RequireAuth } from "./lib/require-role";

// Every screen is lazily imported, which is what preserves the per-route
// code splitting the App Router gave us for free. Without it, Vite would
// emit one bundle containing all seventeen screens and a customer would
// download the entire backoffice to see an order form.
//
// The route tree itself is the replacement for Next's file-based routing:
// the `(backoffice)` / `(customer)` / `(grower)` / `(profile)` route groups
// are now nested <Route> elements sharing a layout, and each group's guard
// is declared once on the parent — the same "one gate per role area, not
// per page" shape the old layouts had.

const Login = lazy(() => import("@/routes/login"));
const ChangePassword = lazy(() => import("@/routes/change-password"));
const ResetPassword = lazy(() => import("@/routes/reset-password"));

const BackofficeLayout = lazy(() => import("@/routes/backoffice/layout"));
const Shop = lazy(() => import("@/routes/backoffice/shop"));
const Arrangement = lazy(() => import("@/routes/backoffice/arrangement"));
const NewArrangement = lazy(() => import("@/routes/backoffice/new-arrangement"));
const OrderHistory = lazy(() => import("@/routes/backoffice/order-history"));
const Products = lazy(() => import("@/routes/backoffice/products"));
const Growers = lazy(() => import("@/routes/backoffice/growers"));
const Customers = lazy(() => import("@/routes/backoffice/customers"));
const Transporters = lazy(() => import("@/routes/backoffice/transporters"));
const Users = lazy(() => import("@/routes/backoffice/users"));
const UsersImport = lazy(() => import("@/routes/backoffice/users-import"));
const UsersReset = lazy(() => import("@/routes/backoffice/users-reset"));
const DistributorGrower = lazy(() => import("@/routes/backoffice/distributor-grower"));
const DistributorCustomer = lazy(() => import("@/routes/backoffice/distributor-customer"));

const CustomerLayout = lazy(() => import("@/routes/customer/layout"));
const CustomerOrder = lazy(() => import("@/routes/customer/order"));
const CustomerHistory = lazy(() => import("@/routes/customer/history"));

const GrowerLayout = lazy(() => import("@/routes/grower/layout"));
const GrowerPicks = lazy(() => import("@/routes/grower/picks"));
const GrowerLegacy = lazy(() => import("@/routes/grower/legacy"));

const ProfileLayout = lazy(() => import("@/routes/profile/layout"));
const Profile = lazy(() => import("@/routes/profile/profile"));

export function AppRoutes() {
  return (
    // Outer boundary for the routes that have no layout of their own (the
    // auth screens). Each role layout declares its own inner <Suspense>
    // around <Outlet />, so navigating *within* a role area swaps only the
    // content and leaves the sidebar mounted — the same behaviour the old
    // app/(backoffice)/loading.tsx gave that route group.
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />

        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/change-password" element={<ChangePassword />} />

        <Route element={<RequireAuth role="backoffice" />}>
          <Route path="/backoffice" element={<BackofficeLayout />}>
            {/* The source's Backoffice has no bare "/backoffice" screen — it
                always lands on a tab. `shop` is the first item in the
                sidebar, so it's the default landing route, per the PRD's
                "self-correct to default tab" rule. */}
            <Route index element={<Navigate to="/backoffice/shop" replace />} />
            <Route path="shop" element={<Shop />} />
            <Route path="arrangement" element={<Arrangement />} />
            <Route path="new-arrangement" element={<NewArrangement />} />
            <Route path="order-history" element={<OrderHistory />} />
            <Route path="products" element={<Products />} />
            <Route path="growers" element={<Growers />} />
            <Route path="customers" element={<Customers />} />
            <Route path="transporters" element={<Transporters />} />
            <Route path="users" element={<Users />} />
            <Route path="users/import" element={<UsersImport />} />
            <Route path="users/reset" element={<UsersReset />} />
            <Route path="distributor-grower" element={<DistributorGrower />} />
            <Route path="distributor-customer" element={<DistributorCustomer />} />
          </Route>
        </Route>

        <Route element={<RequireAuth role="customer" />}>
          <Route path="/customer" element={<CustomerLayout />}>
            {/* Per the PRD, Customer Home's "Data tab" (tab=data, order
                entry) is the default — note the param meaning is inverted
                versus Grower Home's. */}
            <Route index element={<Navigate to="/customer/order" replace />} />
            <Route path="order" element={<CustomerOrder />} />
            <Route path="history" element={<CustomerHistory />} />
          </Route>
        </Route>

        <Route element={<RequireAuth role="grower" />}>
          <Route path="/grower" element={<GrowerLayout />}>
            {/* Per the PRD, Grower Home's "Daily List mode" (tab=list) is the
                default — the source page self-redirects here if the tab
                param is missing. */}
            <Route index element={<Navigate to="/grower/picks" replace />} />
            <Route path="picks" element={<GrowerPicks />} />
            <Route path="legacy" element={<GrowerLegacy />} />
          </Route>
        </Route>

        {/* Per the PRD, User Profile isn't scoped to any one role's routed
            area — any authenticated user can reach it — so RequireAuth gets
            no `role`, matching the old requireSession(). */}
        <Route element={<RequireAuth />}>
          <Route path="/profile" element={<ProfileLayout />}>
            <Route index element={<Profile />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
