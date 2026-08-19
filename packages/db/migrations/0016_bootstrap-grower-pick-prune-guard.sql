-- bootstrap_grower_pick is not Phase-1-only: the distributor's "add
-- products" action on the Grower Inventory Status screen
-- (apps/web/src/app/(backoffice)/backoffice/distributor-grower/page.tsx)
-- calls it directly, any time mid-day, after `save_grower` changes a
-- grower's in-season list. At that point real picking/arrangement
-- activity may already exist against a line whose product just left the
-- in-season list. 0015's prune step deleted any such line unconditionally
-- — a real data-loss bug: removing a product from season (even by
-- mistake) would silently cascade-delete the grower's already-picked
-- quantity and any arrangement_records built against it.
--
-- The fix: only prune a line that has no picked quantity and nothing
-- arranged against it yet. A line with real data left over from a
-- since-removed product is preserved (edited/handled by a person, not
-- silently destroyed by a re-run) — which is what R6 actually calls for
-- here: the rule worth keeping is "arranged supply is never silently
-- destroyed," not "the prune step must be unconditional."
create or replace function public.bootstrap_grower_pick(
  p_trading_day_id uuid,
  p_grower_company_id uuid
)
returns public.daily_picks
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pick public.daily_picks;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  insert into public.daily_picks (trading_day_id, grower_company_id)
  values (p_trading_day_id, p_grower_company_id)
  on conflict (trading_day_id, grower_company_id) do nothing;

  select * into v_pick
  from public.daily_picks
  where trading_day_id = p_trading_day_id and grower_company_id = p_grower_company_id;

  insert into public.daily_pick_products (daily_pick_id, product_variety_id)
  select v_pick.id, gp.product_variety_id
  from public.grower_products gp
  where gp.company_id = p_grower_company_id
  on conflict (daily_pick_id, product_variety_id) do nothing;

  -- Prune: a line whose product fell out of the grower's in-season list
  -- is removed — but only if it's still untouched (nothing picked, nothing
  -- arranged). A line with real data is left in place rather than
  -- cascade-deleted, even though it no longer matches grower_products.
  delete from public.daily_pick_products dpp
  where dpp.daily_pick_id = v_pick.id
    and not exists (
      select 1 from public.grower_products gp
      where gp.company_id = p_grower_company_id
        and gp.product_variety_id = dpp.product_variety_id
    )
    and dpp.pallets_picked = 0
    and not exists (
      select 1 from public.arrangement_records ar
      where ar.daily_pick_product_id = dpp.id
    );

  return v_pick;
end;
$$;

comment on function public.bootstrap_grower_pick(uuid, uuid) is
  'Backoffice-only. Idempotent: creates the grower''s Daily Pick for the day if absent, then upserts its pick-product lines to exactly match grower_products — existing lines (and their pallets_picked/pickup_time/comment) are preserved. Lines for now-out-of-season products are pruned ONLY if untouched (pallets_picked = 0 and no arrangement_records reference them) — a line with real picked or arranged data is preserved rather than cascade-deleted, even mid-day when this is re-invoked after the distributor changes a grower''s in-season list. Safe to call any number of times.';
