-- Sidebar Business-Day Panel's third action ("update inventory for
-- growers"). The source app's daily-pick-bootstrap.md documents a
-- "rerun" mode of the same bootstrap `initiate_business_day` runs once:
-- re-sync every eligible grower's Daily Pick against their CURRENT
-- in-season list, mid-day, without starting a new trading day. Preserved
-- here as its own function rather than an `initiate_business_day` flag
-- (R5 — one named function per derived-state operation), callable any
-- time a trading day is open (unlike the four phase-transition
-- functions, this one does not touch `trading_days.phase` at all — it
-- is a data-refresh, not a lifecycle transition).

create or replace function public.update_growers_data()
returns setof public.daily_picks
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_day from public.trading_days where phase <> 'closed' for update;
  if not found then
    raise exception 'NOT_FOUND: no trading day is open' using errcode = 'P0002';
  end if;

  -- Bootstrap any grower that turned eligible (active, non-empty
  -- in-season list) after the day was initiated — same eligibility
  -- filter as initiate_business_day — and doesn't have a pick yet.
  insert into public.daily_picks (trading_day_id, grower_company_id)
  select v_day.id, c.id
  from public.companies c
  where c.type = 'grower'
    and c.status = 'active'
    and exists (select 1 from public.grower_products gp where gp.company_id = c.id)
    and not exists (
      select 1 from public.daily_picks dp
      where dp.trading_day_id = v_day.id and dp.grower_company_id = c.id
    );

  -- Drop pick-product lines for varieties no longer in the grower's
  -- in-season list (the source's rerun cleanup) — except a line already
  -- referenced by an arrangement record, which the floor invariant in
  -- update_pick_product_pallets protects the same way.
  delete from public.daily_pick_products dpp
  using public.daily_picks dp
  where dpp.daily_pick_id = dp.id
    and dp.trading_day_id = v_day.id
    and not exists (
      select 1 from public.grower_products gp
      where gp.company_id = dp.grower_company_id
        and gp.product_variety_id = dpp.product_variety_id
    )
    and not exists (
      select 1 from public.arrangement_records ar where ar.daily_pick_product_id = dpp.id
    );

  -- Add lines for newly in-season varieties an existing pick doesn't
  -- have yet. Existing lines (and their pallets_picked) are untouched.
  insert into public.daily_pick_products (daily_pick_id, product_variety_id)
  select dp.id, gp.product_variety_id
  from public.daily_picks dp
  join public.grower_products gp on gp.company_id = dp.grower_company_id
  where dp.trading_day_id = v_day.id
    and not exists (
      select 1 from public.daily_pick_products dpp
      where dpp.daily_pick_id = dp.id and dpp.product_variety_id = gp.product_variety_id
    );

  return query select * from public.daily_picks where trading_day_id = v_day.id;
end;
$$;

comment on function public.update_growers_data() is
  'Backoffice-only. Re-syncs every eligible grower''s Daily Pick against their current in-season list for the open trading day: bootstraps newly-eligible growers, drops out-of-season lines (unless already arranged), adds newly in-season lines. Does not change trading_days.phase. Raises P0002 if no trading day is open.';

grant execute on function public.update_growers_data() to authenticated;
