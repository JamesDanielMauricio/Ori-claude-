-- Takes reference data out of live updates (0060): users (profiles), product
-- families (name, category, photo), product varieties, which products a
-- grower grows (grower_products), and grower / customer / transporter details
-- (companies). They change rarely, and nobody needs to see such a change the
-- instant it's made — James's call, 2026-09-29 — so they no longer make every
-- open screen re-read.
--
-- Such a change still reaches other screens, only not instantly: the next
-- live message of any kind refreshes everything on screen and marks the rest
-- out of date; someone coming back to the app re-reads their screen
-- (apps/web/src/lib/refresh-on-return.ts); and a screen opened on data older
-- than 30 seconds reads it afresh.
--
-- Some of these saves still announce themselves, because the same transaction
-- also writes a table that stays live — which is what those saves need:
--   - save_product (the Products screen, and the price dialog on the
--     arrangement board) always rewrites the variety's per-customer limits
--     (product_customer_caps). A price is a column of product_varieties, so
--     this is what keeps a price change reaching customers' order screens live.
--   - save_user always rewrites the user's blocked products
--     (profile_blocked_products).
--   - save_grower re-syncs that grower's pick list when a day is open
--     (daily_picks / daily_pick_products), which the grower's picks screen
--     shows. With no day open it touches nothing live and stays quiet.
--
-- No security change: this only removes triggers. broadcast_table_changed()
-- and the receive policy on realtime.messages (0060) stay as they are.
-- `if exists` so the migration also runs cleanly on a database where a
-- trigger was already dropped by hand.
drop trigger if exists profiles_broadcast_changed on public.profiles;
drop trigger if exists product_families_broadcast_changed on public.product_families;
drop trigger if exists product_varieties_broadcast_changed on public.product_varieties;
drop trigger if exists grower_products_broadcast_changed on public.grower_products;
drop trigger if exists companies_broadcast_changed on public.companies;
