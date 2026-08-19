-- R7: RLS for the lifecycle tables. General shape follows the established
-- pattern (shared reference data readable by any authenticated user,
-- tenant-scoped data self-or-backoffice, writes backoffice-only) — see
-- docs/SCHEMA_DECISIONS.md. The two grower-initiated actions
-- (submit_pick, update_pick_product_pallets) deliberately do NOT get a
-- "grower can write their own row" RLS policy: forward-only transitions
-- and the arrangement-edit floor check are stateful rules RLS predicates
-- can't express, so those two writes go through `security definer`
-- functions instead (0011) that perform the real authorization check
-- internally and are the sole write path — RLS on the underlying tables
-- stays backoffice-only, closing off any direct-REST bypass of those
-- functions' business rules.

-- 1. trading_days — shared "what day is it" reference data, like
--    companies/product_varieties before it; not tenant-scoped.
alter table public.trading_days enable row level security;
alter table public.trading_days force row level security;

grant select, insert, update, delete on public.trading_days to authenticated;

create policy "trading_days_select_authenticated" on public.trading_days
  for select
  to authenticated
  using (true);

create policy "trading_days_write_backoffice" on public.trading_days
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 2. daily_shops — customers need to know whether the shop is open.
alter table public.daily_shops enable row level security;
alter table public.daily_shops force row level security;

grant select, insert, update, delete on public.daily_shops to authenticated;

create policy "daily_shops_select_authenticated" on public.daily_shops
  for select
  to authenticated
  using (true);

create policy "daily_shops_write_backoffice" on public.daily_shops
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 3. daily_arrangements — backoffice-only surface (the Arrangement View
--    screen), per the PRD.
alter table public.daily_arrangements enable row level security;
alter table public.daily_arrangements force row level security;

grant select, insert, update, delete on public.daily_arrangements to authenticated;

create policy "daily_arrangements_select_backoffice" on public.daily_arrangements
  for select
  to authenticated
  using (public.current_role() = 'backoffice');

create policy "daily_arrangements_write_backoffice" on public.daily_arrangements
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 4. daily_picks — a grower reads their own; backoffice reads/writes all.
alter table public.daily_picks enable row level security;
alter table public.daily_picks force row level security;

grant select, insert, update, delete on public.daily_picks to authenticated;

create policy "daily_picks_select_own" on public.daily_picks
  for select
  to authenticated
  using (grower_company_id = public.current_company_id());

create policy "daily_picks_select_backoffice" on public.daily_picks
  for select
  to authenticated
  using (public.current_role() = 'backoffice');

create policy "daily_picks_write_backoffice" on public.daily_picks
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 5. daily_pick_products — a grower reads their own pick's lines;
--    backoffice reads/writes all.
alter table public.daily_pick_products enable row level security;
alter table public.daily_pick_products force row level security;

grant select, insert, update, delete on public.daily_pick_products to authenticated;

create policy "daily_pick_products_select_own" on public.daily_pick_products
  for select
  to authenticated
  using (
    exists (
      select 1 from public.daily_picks dp
      where dp.id = daily_pick_products.daily_pick_id
        and dp.grower_company_id = public.current_company_id()
    )
  );

create policy "daily_pick_products_select_backoffice" on public.daily_pick_products
  for select
  to authenticated
  using (public.current_role() = 'backoffice');

create policy "daily_pick_products_write_backoffice" on public.daily_pick_products
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 6. daily_orders — a customer reads their own; backoffice reads/writes
--    all. Customer-initiated order entry is a later prompt's scope.
alter table public.daily_orders enable row level security;
alter table public.daily_orders force row level security;

grant select, insert, update, delete on public.daily_orders to authenticated;

create policy "daily_orders_select_own" on public.daily_orders
  for select
  to authenticated
  using (customer_company_id = public.current_company_id());

create policy "daily_orders_select_backoffice" on public.daily_orders
  for select
  to authenticated
  using (public.current_role() = 'backoffice');

create policy "daily_orders_write_backoffice" on public.daily_orders
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 7. arrangement_records — backoffice-only for now; the New Arrangement
--    Wizard (a later prompt) is the actual write surface, and per-party
--    self-visibility can be added when that prompt needs it.
alter table public.arrangement_records enable row level security;
alter table public.arrangement_records force row level security;

grant select, insert, update, delete on public.arrangement_records to authenticated;

create policy "arrangement_records_select_backoffice" on public.arrangement_records
  for select
  to authenticated
  using (public.current_role() = 'backoffice');

create policy "arrangement_records_write_backoffice" on public.arrangement_records
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 8. lifecycle_sessions — admin-only, append-only. No UPDATE/DELETE
--    policy exists for any role (including backoffice) — combined with
--    FORCE ROW LEVEL SECURITY, that's a hard deny, matching the PRD's
--    "sessions are never updated or deleted".
alter table public.lifecycle_sessions enable row level security;
alter table public.lifecycle_sessions force row level security;

grant select, insert on public.lifecycle_sessions to authenticated;

create policy "lifecycle_sessions_select_backoffice" on public.lifecycle_sessions
  for select
  to authenticated
  using (public.current_role() = 'backoffice');

create policy "lifecycle_sessions_insert_backoffice" on public.lifecycle_sessions
  for insert
  to authenticated
  with check (public.current_role() = 'backoffice');
