-- Leftover pallets: a second, carried-forward supply figure, not a
-- one-time end-of-day snapshot.
--
-- `leftover_pallets` (0014) has existed since the grower-picking module was
-- built, but its whole job used to be historical: `close_out_pick_leftovers`
-- wrote it once, at day-close, as `pallets_picked - arranged`, and nothing
-- ever read it again. 0014's own header comment (mirrored on
-- `daily_pick_products.leftover_pallets` in packages/db/src/schema) argued
-- this was correct because the source app's two separate leftover fields
-- were "never two genuinely different values" — just the same number
-- computed at two points in one pipeline (R6).
--
-- THIS MIGRATION REVERSES THAT PREMISE, DELIBERATELY. The distributor asked
-- for leftover stock (produce a grower picked on a prior day that never got
-- arranged to a customer) to carry forward into the next trading day as a
-- second, independently-editable starting quantity — visible and adjustable
-- separately from that day's fresh `pallets_picked`, so a grower can see
-- which pallets are which and can zero out leftover that has since gone bad
-- without touching today's pick. Once carried in, leftover is real,
-- immediately arrangeable supply, on equal footing with a fresh pick — not
-- a second pool requiring a manual move-over step. If a future reader is
-- tempted to collapse these back into one column per the old R6 reasoning:
-- don't — that reasoning no longer holds, this is what makes it not hold.
--
-- Six functions change, in dependency order:
--
--   1. `bootstrap_grower_pick` — Phase-1 (initiate_business_day) line
--      creation. A brand-new line now seeds leftover_pallets from the same
--      grower+variety's most recent PRIOR line, instead of always 0. Only
--      ever touches a line that doesn't exist yet for today (the insert is
--      `on conflict do nothing`), so it can never clobber same-day edits.
--      Its prune guard is extended so a line carrying real leftover stock
--      is never silently deleted just because the variety left season.
--   2. `sync_grower_picks` — the OTHER, independent line-creation path (the
--      distributor's "add products" mid-day flow, via save_grower). It does
--      not call bootstrap_grower_pick and has always had its own
--      insert/prune logic — both need the identical carry-forward and
--      leftover-aware prune guard, or the path growers hit constantly
--      mid-day would silently never carry leftover forward.
--   3. `close_out_pick_leftovers` — the end-of-day computation now folds in
--      whatever leftover carried INTO the closing day and was never
--      arranged either: `pallets_picked + leftover_pallets - arranged`,
--      not just `pallets_picked - arranged`.
--   4. `check_arrangement_allocation` — the distributor's over-allocation
--      guard. The supply-side ceiling becomes `pallets_picked +
--      leftover_pallets`, since leftover is now real arrangeable stock.
--   5. `save_pick_lines` — the ONE function the grower's picking editor
--      actually calls (apps/web/src/components/grower/pick-lines-editor.tsx).
--      Each line gains a `leftoverPallets` field, validated the same way
--      `palletsPicked` already is. The arrangement-edit floor (never reduce
--      below what's already committed to a customer) now applies to the
--      COMBINED total, not `pallets_picked` alone — a grower may freely
--      shift quantity between the two fields, or zero out leftover, as long
--      as the sum never drops below what's arranged.
--   6. `update_pick_product_pallets` — the single-field legacy sibling of
--      save_pick_lines (not called by the app, only by packages/domain
--      integration tests). Gets the same floor fix for consistency — no new
--      parameter, it still only ever sets pallets_picked.

-- ---------------------------------------------------------------------------
-- 0. Column: leftover_pallets becomes NOT NULL, defaulting to 0.
-- ---------------------------------------------------------------------------
-- It was nullable because it used to be write-once, at close, so a still-open
-- day's rows were legitimately unset. Now every row needs a real number from
-- the moment it's created (bootstrap_grower_pick / sync_grower_picks always
-- provide one), so NULL no longer means anything distinct from 0 — collapsing
-- it removes a "was this day ever closed" flag that nothing actually read.
update public.daily_pick_products set leftover_pallets = 0 where leftover_pallets is null;

alter table public.daily_pick_products
  alter column leftover_pallets set default '0',
  alter column leftover_pallets set not null;

-- ---------------------------------------------------------------------------
-- 1. bootstrap_grower_pick
-- ---------------------------------------------------------------------------
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

  -- Upsert: a line already on the pick keeps everything it has
  -- (pallets_picked, leftover_pallets, comment) untouched — `do nothing`, not
  -- `do update`. A genuinely NEW line seeds leftover_pallets from this same
  -- grower+variety's most recent OTHER line (ordered by trade_date, then by
  -- when that pick was created, so two days sharing a trade_date — nothing
  -- stops that; only "at most one OPEN day" is enforced — still resolve
  -- deterministically). `dp2.id <> v_pick.id` self-excludes rather than
  -- comparing trade_date, so this is correct even on a same-day re-run.
  insert into public.daily_pick_products (daily_pick_id, product_variety_id, leftover_pallets)
  select
    v_pick.id,
    gp.product_variety_id,
    coalesce(v_prev.leftover_pallets, 0)
  from public.grower_products gp
  left join lateral (
    select dpp2.leftover_pallets
    from public.daily_pick_products dpp2
    join public.daily_picks dp2 on dp2.id = dpp2.daily_pick_id
    join public.trading_days td2 on td2.id = dp2.trading_day_id
    where dp2.grower_company_id = p_grower_company_id
      and dpp2.product_variety_id = gp.product_variety_id
      and dp2.id <> v_pick.id
    order by td2.trade_date desc, dp2.created_at desc
    limit 1
  ) v_prev on true
  where gp.company_id = p_grower_company_id
  on conflict (daily_pick_id, product_variety_id) do nothing;

  -- Prune: a line whose product fell out of the grower's in-season list is
  -- removed — but only if it's still untouched (nothing picked, nothing left
  -- over from a prior day, nothing arranged). A line with real data of any
  -- kind is left in place rather than cascade-deleted, even though it no
  -- longer matches grower_products.
  delete from public.daily_pick_products dpp
  where dpp.daily_pick_id = v_pick.id
    and not exists (
      select 1 from public.grower_products gp
      where gp.company_id = p_grower_company_id
        and gp.product_variety_id = dpp.product_variety_id
    )
    and dpp.pallets_picked = 0
    and coalesce(dpp.leftover_pallets, 0) = 0
    and not exists (
      select 1 from public.arrangement_records ar
      where ar.daily_pick_product_id = dpp.id
    );

  return v_pick;
end;
$$;

comment on function public.bootstrap_grower_pick(uuid, uuid) is
  'Backoffice-only. Idempotent: creates the grower''s Daily Pick for the day if absent, then upserts its pick-product lines to exactly match grower_products — existing lines (and their pallets_picked/leftover_pallets/comment) are preserved. A newly-created line seeds leftover_pallets from this same grower+variety''s most recent OTHER line, so unsold stock carries forward across trading days. Lines for now-out-of-season products are pruned ONLY if untouched (pallets_picked = 0, leftover_pallets = 0, and no arrangement_records reference them). Safe to call any number of times.';

-- ---------------------------------------------------------------------------
-- 2. sync_grower_picks
-- ---------------------------------------------------------------------------
-- The OTHER line-creation path: does not call bootstrap_grower_pick, has its
-- own insert/prune (0037) — needs the identical carry-forward and guard.
create or replace function public.sync_grower_picks(p_grower_company_id uuid default null)
returns void
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

  -- Drop pick lines for varieties no longer in the grower's in-season list.
  -- A line already referenced by an arrangement record, or still carrying
  -- real leftover stock, is left alone rather than cascade-deleted.
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
  'Backoffice-only. Re-syncs Daily Pick lines against the current in-season list for the open trading day: bootstraps newly-eligible growers, drops out-of-season lines (unless already arranged or still carrying leftover stock), adds newly in-season lines — seeding leftover_pallets from this grower+variety''s most recent prior line, same as bootstrap_grower_pick. Pass a grower company id to sync one grower, or null for all of them. No-op when no trading day is open. Does not change trading_days.phase.';

-- ---------------------------------------------------------------------------
-- 3. close_out_pick_leftovers
-- ---------------------------------------------------------------------------
create or replace function public.close_out_pick_leftovers(p_trading_day_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated integer;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  -- picked + whatever carried into today as leftover, minus arranged. Not
  -- just picked - arranged: today's own leftover_pallets already holds
  -- yesterday's carry-in (bootstrap_grower_pick / sync_grower_picks), and
  -- that has to fold into today's ending figure too, or unsold stock would
  -- quietly reset to just today's unarranged pick every time it closes.
  update public.daily_pick_products dpp
  set leftover_pallets = dpp.pallets_picked + coalesce(dpp.leftover_pallets, 0) - coalesce(
        (select sum(ar.quantity_pallets)
           from public.arrangement_records ar
          where ar.daily_pick_product_id = dpp.id),
        0
      ),
      updated_at = now()
  where dpp.daily_pick_id in (
    select id from public.daily_picks where trading_day_id = p_trading_day_id
  );

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

comment on function public.close_out_pick_leftovers(uuid) is
  'Backoffice-only. Sets leftover_pallets = pallets_picked + prior leftover_pallets - arranged, for every pick-product line belonging to the trading day''s picks. Called directly from close_arrangement (same transaction); also directly callable/testable on its own.';

-- ---------------------------------------------------------------------------
-- 4. check_arrangement_allocation
-- ---------------------------------------------------------------------------
create or replace function public.check_arrangement_allocation(
  p_daily_pick_product_id uuid,
  p_daily_order_product_id uuid,
  p_quantity_pallets numeric,
  p_excluding_record_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pallets_picked numeric;
  v_leftover_pallets numeric;
  v_pallets_ordered numeric;
  v_supply_arranged numeric;
  v_demand_arranged numeric;
begin
  if p_quantity_pallets <= 0 then
    raise exception 'INVALID_INPUT: quantity must be positive' using errcode = 'P0008';
  end if;

  select pallets_picked, leftover_pallets into v_pallets_picked, v_leftover_pallets
  from public.daily_pick_products where id = p_daily_pick_product_id;

  select coalesce(sum(quantity_pallets), 0) into v_supply_arranged
  from public.arrangement_records
  where daily_pick_product_id = p_daily_pick_product_id
    and (p_excluding_record_id is null or id <> p_excluding_record_id);

  -- The ceiling is picked + leftover, not picked alone: carried-forward
  -- leftover is real, immediately arrangeable supply on equal footing with a
  -- fresh pick (see this file's header).
  if v_supply_arranged + p_quantity_pallets > v_pallets_picked + coalesce(v_leftover_pallets, 0) then
    raise exception 'OVER_ALLOCATION: % pallets already arranged + % requested exceeds % pallets picked + leftover on this line',
      v_supply_arranged, p_quantity_pallets, v_pallets_picked + coalesce(v_leftover_pallets, 0)
      using errcode = 'P0009';
  end if;

  select pallets_ordered into v_pallets_ordered
  from public.daily_order_products where id = p_daily_order_product_id;

  -- The one behavioural change: a zero-pallet order line carries a
  -- distributor push, not a customer request, so there is no request for
  -- the allocation to exceed.
  if coalesce(v_pallets_ordered, 0) > 0 then
    select coalesce(sum(quantity_pallets), 0) into v_demand_arranged
    from public.arrangement_records
    where daily_order_product_id = p_daily_order_product_id
      and (p_excluding_record_id is null or id <> p_excluding_record_id);

    if v_demand_arranged + p_quantity_pallets > v_pallets_ordered then
      raise exception 'OVER_ALLOCATION: % pallets already arranged + % requested exceeds % pallets ordered on this line',
        v_demand_arranged, p_quantity_pallets, v_pallets_ordered
        using errcode = 'P0009';
    end if;
  end if;
end;
$$;

comment on function public.check_arrangement_allocation(uuid, uuid, numeric, uuid) is
  'Internal. Raises P0009 if arranging p_quantity_pallets would exceed the pick line''s pallets_picked + leftover_pallets (carried-forward leftover counts as real supply), summed against every OTHER arrangement_records row referencing it. The same ceiling is applied to the order line''s pallets_ordered ONLY when that value is greater than zero: a zero-pallet order line is one arrange_to_customer created for a customer who never ordered the variety, and exists solely to carry a distributor push. Shared by create_arrangement_record, update_arrangement_record and arrange_to_customer so the rule can''t drift between them.';

-- ---------------------------------------------------------------------------
-- 5. save_pick_lines
-- ---------------------------------------------------------------------------
-- p_lines shape: [{ "dailyPickProductId": uuid,
--                   "palletsPicked": number,
--                   "leftoverPallets": number,
--                   "comment": string | null }, ...]
create or replace function public.save_pick_lines(
  p_daily_pick_id uuid,
  p_lines jsonb
)
returns setof public.daily_pick_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grower_company_id uuid;
  v_grower_company_name text;
  v_pick_status public.daily_pick_status;
  v_trading_day_id uuid;
  v_trade_date date;
  v_is_grower_initiated boolean;
  v_line jsonb;
  v_line_id uuid;
  v_pallets numeric;
  v_leftover numeric;
  v_comment text;
  v_existing public.daily_pick_products;
  v_arranged numeric;
  v_any_quantity_changed boolean := false;
begin
  v_is_grower_initiated := public.current_role() = 'grower';

  select dp.grower_company_id, dp.status, dp.trading_day_id, gc.name
    into v_grower_company_id, v_pick_status, v_trading_day_id, v_grower_company_name
  from public.daily_picks dp
  join public.companies gc on gc.id = dp.grower_company_id
  where dp.id = p_daily_pick_id
  for update of dp;

  if not found then
    raise exception 'NOT_FOUND: daily pick % does not exist', p_daily_pick_id using errcode = 'P0002';
  end if;

  if public.current_role() <> 'backoffice' and v_grower_company_id <> public.current_company_id() then
    raise exception 'FORBIDDEN: not this pick''s grower' using errcode = '42501';
  end if;

  if v_pick_status = 'closed' then
    raise exception 'INVALID_STATE: this pick is closed — no further edits are permitted' using errcode = 'P0007';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id := (v_line ->> 'dailyPickProductId')::uuid;
    v_pallets := (v_line ->> 'palletsPicked')::numeric;
    v_leftover := (v_line ->> 'leftoverPallets')::numeric;
    v_comment := nullif(v_line ->> 'comment', '');

    if v_pallets is null then
      raise exception 'INVALID_INPUT: pallets picked is required for line %', v_line_id using errcode = 'P0008';
    end if;

    if v_pallets < 0 then
      raise exception 'INVALID_INPUT: pallets picked cannot be negative' using errcode = 'P0008';
    end if;

    if v_leftover is null then
      raise exception 'INVALID_INPUT: leftover pallets is required for line %', v_line_id using errcode = 'P0008';
    end if;

    if v_leftover < 0 then
      raise exception 'INVALID_INPUT: leftover pallets cannot be negative' using errcode = 'P0008';
    end if;

    select * into v_existing
    from public.daily_pick_products
    where id = v_line_id
    for update;

    if not found then
      raise exception 'NOT_FOUND: pick product line % does not exist', v_line_id using errcode = 'P0002';
    end if;

    if v_existing.daily_pick_id <> p_daily_pick_id then
      raise exception 'FORBIDDEN: pick product line % does not belong to daily pick %',
        v_line_id, p_daily_pick_id using errcode = '42501';
    end if;

    -- The arrangement-edit floor, extended to the COMBINED total: a grower
    -- may not retract supply the distributor has already committed to
    -- customers, but may freely shift quantity between picked and leftover
    -- (or zero out leftover that's gone bad) as long as the sum holds.
    -- Evaluated only when either field actually changed, so re-saving an
    -- untouched line can never fail on a floor breached by someone else's
    -- later allocation.
    if v_pallets <> v_existing.pallets_picked or v_leftover <> coalesce(v_existing.leftover_pallets, 0) then
      select coalesce(sum(quantity_pallets), 0) into v_arranged
      from public.arrangement_records
      where daily_pick_product_id = v_line_id;

      if v_pallets + v_leftover < v_arranged then
        raise exception
          'CONFLICT: cannot reduce pallets picked + leftover to % — % pallets already arranged to customers for this line',
          v_pallets + v_leftover, v_arranged
          using errcode = 'P0006';
      end if;

      v_any_quantity_changed := true;
    end if;

    update public.daily_pick_products
    set pallets_picked = v_pallets,
        leftover_pallets = v_leftover,
        comment = v_comment,
        updated_at = now()
    where id = v_line_id;
  end loop;

  -- ONE pick_updated alert per save, not one per changed line. Still gated on
  -- the grower being the actor: backoffice editing a pick on the grower's
  -- behalf must not notify backoffice about backoffice's own action.
  if v_is_grower_initiated and v_any_quantity_changed then
    select trade_date into v_trade_date from public.trading_days where id = v_trading_day_id;
    perform public.enqueue_backoffice_notification(
      v_trading_day_id, 'pick_updated',
      jsonb_build_object('tradeDate', v_trade_date, 'lines', '[]'::jsonb, 'companyName', v_grower_company_name)
    );
  end if;

  return query
    select * from public.daily_pick_products
    where daily_pick_id = p_daily_pick_id
    order by product_variety_id;
end;
$$;

comment on function public.save_pick_lines(uuid, jsonb) is
  'The owning grower (or backoffice). Saves every line of one Daily Pick in a single transaction: pallets_picked, leftover_pallets and comment per line, all-or-nothing. Enforces P0002 unknown pick/line, 42501 wrong grower or a line not belonging to this pick, P0007 closed pick, P0008 negative/missing quantity, and P0006 — the arrangement floor, now checked against pallets_picked + leftover_pallets COMBINED, so a grower may shift quantity between the two fields freely as long as the sum never drops below what''s already arranged. Enqueues at most one pick_updated backoffice notification per save when the grower themselves changed a quantity. Returns the pick''s full line set as saved.';

-- ---------------------------------------------------------------------------
-- 6. update_pick_product_pallets
-- ---------------------------------------------------------------------------
-- Floor-only fix. No new parameter: this single-field legacy sibling of
-- save_pick_lines still only ever sets pallets_picked (it is not called from
-- apps/web, only exercised by packages/domain integration tests), but its
-- floor check has to account for the row's own leftover_pallets or it would
-- reject a reduction save_pick_lines would correctly allow.
create or replace function public.update_pick_product_pallets(
  p_daily_pick_product_id uuid,
  p_pallets_picked numeric
)
returns public.daily_pick_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.daily_pick_products;
  v_grower_company_id uuid;
  v_grower_company_name text;
  v_pick_status public.daily_pick_status;
  v_trading_day_id uuid;
  v_trade_date date;
  v_leftover numeric;
  v_arranged numeric;
  v_is_grower_initiated boolean;
begin
  if p_pallets_picked < 0 then
    raise exception 'INVALID_INPUT: pallets picked cannot be negative' using errcode = 'P0008';
  end if;

  v_is_grower_initiated := public.current_role() = 'grower';

  select dp.grower_company_id, dp.status, dp.trading_day_id, gc.name, dpp.leftover_pallets
    into v_grower_company_id, v_pick_status, v_trading_day_id, v_grower_company_name, v_leftover
  from public.daily_pick_products dpp
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  join public.companies gc on gc.id = dp.grower_company_id
  where dpp.id = p_daily_pick_product_id
  for update of dpp;

  if not found then
    raise exception 'NOT_FOUND: pick product line % does not exist', p_daily_pick_product_id using errcode = 'P0002';
  end if;

  if public.current_role() <> 'backoffice' and v_grower_company_id <> public.current_company_id() then
    raise exception 'FORBIDDEN: not this pick''s grower' using errcode = '42501';
  end if;

  if v_pick_status = 'closed' then
    raise exception 'INVALID_STATE: this pick is closed — no further edits are permitted' using errcode = 'P0007';
  end if;

  select coalesce(sum(quantity_pallets), 0) into v_arranged
  from public.arrangement_records
  where daily_pick_product_id = p_daily_pick_product_id;

  if p_pallets_picked + coalesce(v_leftover, 0) < v_arranged then
    raise exception
      'CONFLICT: cannot reduce pallets picked + leftover to % — % pallets already arranged to customers for this line',
      p_pallets_picked + coalesce(v_leftover, 0), v_arranged
      using errcode = 'P0006';
  end if;

  update public.daily_pick_products
  set pallets_picked = p_pallets_picked, updated_at = now()
  where id = p_daily_pick_product_id
  returning * into v_line;

  if v_is_grower_initiated then
    select trade_date into v_trade_date from public.trading_days where id = v_trading_day_id;
    perform public.enqueue_backoffice_notification(
      v_trading_day_id, 'pick_updated',
      jsonb_build_object('tradeDate', v_trade_date, 'lines', '[]'::jsonb, 'companyName', v_grower_company_name)
    );
  end if;

  return v_line;
end;
$$;

comment on function public.update_pick_product_pallets(uuid, numeric) is
  'The owning grower (or backoffice). Updates a Daily Pick Product line''s pallets_picked. security definer for the same reason as submit_pick. Enforces the arrangement-edit rule against the COMBINED pallets_picked + leftover_pallets (raises P0006), and rejects edits once the parent pick is closed (P0007). When the caller is the grower themselves (not backoffice acting on their behalf), enqueues one pick_updated notification_outbox row to backoffice (id 3).';
