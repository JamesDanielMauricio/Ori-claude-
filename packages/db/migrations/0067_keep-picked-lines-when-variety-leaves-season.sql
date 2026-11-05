-- Taking a variety out of a grower's season no longer deletes today's pick
-- line when the grower has already picked pallets on it.
--
-- save_grower — the Growers screen's save, and the "בשם מגדל" products
-- dialog — replaces a grower's in-season list and then calls
-- sync_grower_picks, which removes today's pick lines for every variety that
-- left the list. Its guard spared a line still carrying leftover stock (0050)
-- or with pallets arranged to a customer (0037), but never checked the pallets
-- PICKED on it. So unticking a variety the grower had already picked, say, 12
-- pallets of deleted those 12 pallets — no warning, and no way back.
--
-- bootstrap_grower_pick, the other function that removes these lines, has
-- refused to delete a picked line since 0016, and 0050's own header asked for
-- the two guards to be "identical". This makes them so: a line is removed
-- only when there is nothing on it — 0 picked, 0 leftover, nothing arranged.
-- A line that holds stock stays on today's pick as it is: still on sale,
-- still arrangeable, still editable from the pencil. Being out of season, it
-- simply gets no line on the next trading day.
--
-- Bubble deleted these lines too, after a yes/no popup. Ori keeps them
-- instead, so there is no stock to lose and nothing to warn about.
--
-- Only sync_grower_picks changes, and only by the one condition marked
-- "0067" below; the rest of its body is copied unchanged from 0050, its
-- latest definition. Safe to run more than once (create or replace).

create or replace function public.sync_grower_picks(p_grower_company_id uuid default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
begin
  -- SECURITY: ALLOWS a backoffice account to re-sync pick lines. PROTECTS
  -- AGAINST a grower or customer calling it straight through the API (every
  -- signed-in account may execute it) to add or delete pick lines. A caller
  -- with no profile at all has a NULL role, and NULL <> 'backoffice' does not
  -- raise; that caller is stopped by row-level security instead, because this
  -- function runs as its caller (security invoker) and only backoffice may
  -- write daily_picks and daily_pick_products. Unchanged from 0050.
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_day from public.trading_days where phase <> 'closed' for update;
  if not found then
    return;
  end if;

  insert into public.daily_picks (trading_day_id, grower_company_id)
  select v_day.id, c.id
  from public.companies c
  where c.type = 'grower'
    and c.status = 'active'
    and (p_grower_company_id is null or c.id = p_grower_company_id)
    and exists (select 1 from public.grower_products gp where gp.company_id = c.id)
    and not exists (
      select 1 from public.daily_picks dp
      where dp.trading_day_id = v_day.id and dp.grower_company_id = c.id
    );

  -- Drop pick lines for varieties no longer in the grower's in-season list —
  -- but only a line with nothing on it. One the grower has picked pallets on,
  -- one still carrying leftover stock, or one already referenced by an
  -- arrangement record is left alone rather than deleted (or cascade-deleted).
  delete from public.daily_pick_products dpp
  using public.daily_picks dp
  where dpp.daily_pick_id = dp.id
    and dp.trading_day_id = v_day.id
    and (p_grower_company_id is null or dp.grower_company_id = p_grower_company_id)
    and not exists (
      select 1 from public.grower_products gp
      where gp.company_id = dp.grower_company_id
        and gp.product_variety_id = dpp.product_variety_id
    )
    -- 0067: picked pallets are stock too — the condition 0037 and 0050 missed.
    and dpp.pallets_picked = 0
    and coalesce(dpp.leftover_pallets, 0) = 0
    and not exists (
      select 1 from public.arrangement_records ar where ar.daily_pick_product_id = dpp.id
    );

  -- Add lines for newly in-season varieties. Existing lines — and the
  -- pallets_picked/leftover_pallets already on them — are untouched. A
  -- genuinely new line seeds leftover_pallets the same way
  -- bootstrap_grower_pick does: from this grower+variety's most recent
  -- OTHER line.
  insert into public.daily_pick_products (daily_pick_id, product_variety_id, leftover_pallets)
  select
    dp.id,
    gp.product_variety_id,
    coalesce(v_prev.leftover_pallets, 0)
  from public.daily_picks dp
  join public.grower_products gp on gp.company_id = dp.grower_company_id
  left join lateral (
    select dpp2.leftover_pallets
    from public.daily_pick_products dpp2
    join public.daily_picks dp2 on dp2.id = dpp2.daily_pick_id
    join public.trading_days td2 on td2.id = dp2.trading_day_id
    where dp2.grower_company_id = dp.grower_company_id
      and dpp2.product_variety_id = gp.product_variety_id
      and dp2.id <> dp.id
    order by td2.trade_date desc, dp2.created_at desc
    limit 1
  ) v_prev on true
  where dp.trading_day_id = v_day.id
    and (p_grower_company_id is null or dp.grower_company_id = p_grower_company_id)
    and not exists (
      select 1 from public.daily_pick_products dpp
      where dpp.daily_pick_id = dp.id and dpp.product_variety_id = gp.product_variety_id
    );
end;
$$;

comment on function public.sync_grower_picks(uuid) is
  'Backoffice-only. Re-syncs Daily Pick lines against the current in-season list for the open trading day: bootstraps newly-eligible growers, drops out-of-season lines ONLY if untouched (pallets_picked = 0, leftover_pallets = 0, and no arrangement_records reference them — migration 0067 added the pallets_picked condition, matching bootstrap_grower_pick), adds newly in-season lines — seeding leftover_pallets from this grower+variety''s most recent prior line, same as bootstrap_grower_pick. Pass a grower company id to sync one grower, or null for all of them. No-op when no trading day is open. Does not change trading_days.phase.';
