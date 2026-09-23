import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { HomeRedirect } from "@/routes/home-redirect";
import NotFound from "@/routes/not-found";

import { lazyRoute } from "./lib/lazy-route";
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
//
// They go through lazyRoute rather than React's lazy directly: code-split
// chunks are named by content hash, so a deploy renames every one of them
// and a tab left open across that deploy asks for files the live deployment
// no longer has. lib/lazy-route.ts turns that into one silent reload instead
// of a blank page. Change one, read the other.

const Login = lazyRoute(() => import("@/routes/login"));
const ChangePassword = lazyRoute(() => import("@/routes/change-password"));
const ResetPassword = lazyRoute(() => import("@/routes/reset-password"));

const BackofficeLayout = lazyRoute(() => import("@/routes/backoffice/layout"));
const Shop = lazyRoute(() => import("@/routes/backoffice/shop"));
const Arrangement = lazyRoute(() => import("@/routes/backoffice/arrangement"));
const NewArrangement = lazyRoute(() => import("@/routes/backoffice/new-arrangement"));
const OrderHistory = lazyRoute(() => import("@/routes/backoffice/order-history"));
const Products = lazyRoute(() => import("@/routes/backoffice/products"));
const PickedProducts = lazyRoute(() => import("@/routes/backoffice/picked-products"));
const Growers = lazyRoute(() => import("@/routes/backoffice/growers"));
const Customers = lazyRoute(() => import("@/routes/backoffice/customers"));
const Transporters = lazyRoute(() => import("@/routes/backoffice/transporters"));
const Users = lazyRoute(() => import("@/routes/backoffice/users"));
const UsersImport = lazyRoute(() => import("@/routes/backoffice/users-import"));
const UsersReset = lazyRoute(() => import("@/routes/backoffice/users-reset"));
const DistributorGrower = lazyRoute(() => import("@/routes/backoffice/distributor-grower"));
const DistributorCustomer = lazyRoute(() => import("@/routes/backoffice/distributor-customer"));

const CustomerLayout = lazyRoute(() => import("@/routes/customer/layout"));
const CustomerOrder = lazyRoute(() => import("@/routes/customer/order"));
const CustomerHistory = lazyRoute(() => import("@/routes/customer/history"));

const GrowerLayout = lazyRoute(() => import("@/routes/grower/layout"));
const GrowerPicks = lazyRoute(() => import("@/routes/grower/picks"));
const GrowerHistory = lazyRoute(() => import("@/routes/grower/history"));

const ProfileLayout = lazyRoute(() => import("@/routes/profile/layout"));
const Profile = lazyRoute(() => import("@/routes/profile/profile"));

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
            <Route path="picked-products" element={<PickedProducts />} />
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
            <Route path="history" element={<GrowerHistory />} />
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
