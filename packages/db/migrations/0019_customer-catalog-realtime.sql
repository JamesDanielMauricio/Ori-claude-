-- Optional (not required for functional parity): lets the customer order
-- screen replace the source's "re-query on every row expand" pattern with
-- a genuine push update, so the catalog reflects a grower's pick edit or
-- another customer's order edit without polling. Only the two tables that
-- actually feed shop_variety_orderability's supply/demand math are added
-- to the publication — the client-side subscription (see
-- apps/web/src/app/(customer)/customer/order/page.tsx) only uses these
-- events as a trigger to re-run get_orderable_catalog_for_customer through
-- the caller's own RLS-governed session; it never reads the broadcast
-- row payload itself, so this stays consistent with that function's
-- privacy boundary (no raw cross-tenant row ever needs to reach the
-- client for this to work).
alter publication supabase_realtime add table public.daily_pick_products;
alter publication supabase_realtime add table public.daily_order_products;
