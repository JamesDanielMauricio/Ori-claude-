-- R4, the Supabase way: each of the four phase-transition endpoints is one
-- plpgsql function invoked via `supabase.rpc()`. PostgREST has no concept
-- of a multi-statement client transaction, so this is the only place
-- "every side effect of this phase commits together, or none of it does"
-- can actually be guaranteed. `security invoker` (the default, stated
-- explicitly) for all four: they run with the calling backoffice user's
-- own privileges, so RLS (0010) still governs every write inside them —
-- consistent with the reference-data module's functions, since backoffice
-- is the only caller and the RLS write policies already say exactly that.
--
-- `submit_pick` and `update_pick_product_pallets` are different: they're
-- GROWER-initiated, and the rules they enforce (forward-only status,
-- the arrangement-edit floor) are stateful — a RLS predicate can't express
-- "the new value must be >= a computed sum" or "this status may only
-- move from draft to submitted". Those two are `security definer`,
-- performing their own explicit authorization check internally and acting
-- as the sole write path for their tables' mutable fields (0010 grants no
-- general grower write policy on daily_picks/daily_pick_products).
--
-- A design note worth stating once, since it's the backbone of Invariant
-- 3: there is no App Settings singleton and nothing to "reset" at
-- close_arrangement. A trading day's shop/picks/orders/arrangement are
-- just rows with a `trading_day_id` foreign key; once a day's `phase`
-- reaches 'closed', a query for "the open day" (`phase <> 'closed'`)
-- stops finding it, and the very next `initiate_business_day` is free to
-- insert a new one (guarded by the partial unique index from 0009). The
-- invariant holds by construction, not by field-by-field clearing.
--
-- Every one of the four functions locates "the current open day" with
-- `select ... for update` before checking its phase. This does more than
-- the task's two explicitly-named concurrency guards (initiate/open): it
-- also serializes concurrent close_shop/close_arrangement calls on the
-- same day — the second caller's SELECT blocks on the first's row lock,
-- then re-reads the now-committed phase and finds it's moved past the
-- phase this function expects, raising a clear error instead of running
-- twice. This directly fixes the source's documented close_arrangement
-- double-click bug (duplicate Session, would-be duplicate WhatsApp) rather
-- than reproducing it (R6) — the invariant being preserved is Invariant 2
-- (forward-only), the implementation being discarded is "no guard at all".

-- 1. initiate_business_day — Phase 1.
create or replace function public.initiate_business_day(p_trade_date date)
returns public.trading_days
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

  begin
    insert into public.trading_days (trade_date, phase, initiated_by)
    values (p_trade_date, 'initiated', (select auth.uid()))
    returning * into v_day;
  exception
    when unique_violation then
      raise exception 'DAY_ALREADY_OPEN: a trading day is already in progress — close it before initiating a new one'
        using errcode = 'P0004';
  end;

  insert into public.daily_arrangements (trading_day_id, status)
  values (v_day.id, 'open');

  -- Bootstrap: one daily_pick per active grower with a non-empty
  -- in-season list (the source's eligibility filter, preserved exactly —
  -- initiate-business-day-phase-1.md). Growers without in-season products
  -- are silently skipped, matching documented behavior, not a bug here.
  insert into public.daily_picks (trading_day_id, grower_company_id)
  select v_day.id, c.id
  from public.companies c
  where c.type = 'grower'
    and c.status = 'active'
    and exists (select 1 from public.grower_products gp where gp.company_id = c.id);

  -- One daily_pick_product per grower's in-season variety, starting at 0
  -- pallets picked.
  insert into public.daily_pick_products (daily_pick_id, product_variety_id)
  select dp.id, gp.product_variety_id
  from public.daily_picks dp
  join public.grower_products gp on gp.company_id = dp.grower_company_id
  where dp.trading_day_id = v_day.id;

  return v_day;
end;
$$;

comment on function public.initiate_business_day(date) is
  'Backoffice-only. Phase 1: opens a new trading day, creates its Daily Arrangement, and bootstraps a Daily Pick (+ pick-product lines) for every active grower with a non-empty in-season list. Raises P0004 if a trading day is already open (Lifecycle Invariant 1 / the concurrency guard).';

grant execute on function public.initiate_business_day(date) to authenticated;

-- 2. open_shop — Phase 2.
create or replace function public.open_shop(p_can_see_prices boolean default true)
returns public.daily_shops
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
  v_shop public.daily_shops;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_day from public.trading_days where phase <> 'closed' for update;
  if not found then
    raise exception 'NOT_FOUND: no trading day is open' using errcode = 'P0002';
  end if;
  if v_day.phase <> 'initiated' then
    raise exception 'INVALID_STATE: cannot open shop — trading day is in phase %, expected initiated', v_day.phase
      using errcode = 'P0007';
  end if;

  begin
    insert into public.daily_shops (trading_day_id, can_see_prices, opened_by)
    values (v_day.id, p_can_see_prices, (select auth.uid()))
    returning * into v_shop;
  exception
    when unique_violation then
      raise exception 'SHOP_ALREADY_OPEN: this trading day already has a shop' using errcode = 'P0005';
  end;

  update public.trading_days set phase = 'shop_open', updated_at = now() where id = v_day.id;

  -- Bootstrap: one daily_order header per active customer.
  insert into public.daily_orders (trading_day_id, customer_company_id)
  select v_day.id, c.id
  from public.companies c
  where c.type = 'customer'
    and c.status = 'active';

  return v_shop;
end;
$$;

comment on function public.open_shop(boolean) is
  'Backoffice-only. Phase 2: opens the day''s shop and bootstraps a Daily Order header for every active customer. Raises P0007 if the day is not in phase "initiated", P0005 on a concurrent double-open.';

grant execute on function public.open_shop(boolean) to authenticated;

-- 3. close_shop — Phase 3.
create or replace function public.close_shop()
returns public.lifecycle_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
  v_session public.lifecycle_sessions;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_day from public.trading_days where phase <> 'closed' for update;
  if not found then
    raise exception 'NOT_FOUND: no trading day is open' using errcode = 'P0002';
  end if;
  if v_day.phase <> 'shop_open' then
    raise exception 'INVALID_STATE: cannot close shop — trading day is in phase %, expected shop_open', v_day.phase
      using errcode = 'P0007';
  end if;

  update public.trading_days set phase = 'shop_closed', updated_at = now() where id = v_day.id;
  update public.daily_shops set status = 'closed', updated_at = now() where trading_day_id = v_day.id;

  -- Logged last, on success (R6) — see the header comment on this file.
  insert into public.lifecycle_sessions (trading_day_id, session_type, performed_by, metadata)
  values (v_day.id, 'close_shop', (select auth.uid()), '{}'::jsonb)
  returning * into v_session;

  return v_session;
end;
$$;

comment on function public.close_shop() is
  'Backoffice-only. Phase 3: closes the day''s shop (customers can no longer order; growers may still edit picks) and logs a close_shop session. Raises P0007 if the day is not in phase "shop_open".';

grant execute on function public.close_shop() to authenticated;

-- 4. close_arrangement — Phase 4 (terminal).
create or replace function public.close_arrangement()
returns public.lifecycle_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
  v_session public.lifecycle_sessions;
  v_draft_picks jsonb;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_day from public.trading_days where phase <> 'closed' for update;
  if not found then
    raise exception 'NOT_FOUND: no trading day is open' using errcode = 'P0002';
  end if;
  if v_day.phase <> 'shop_closed' then
    raise exception 'INVALID_STATE: cannot close arrangement — trading day is in phase %, expected shop_closed', v_day.phase
      using errcode = 'P0007';
  end if;

  -- Invariant 4: surface which picks were still open when phase 4
  -- arrived, rather than silently folding them into the mass-close — a
  -- legitimate no-show or a bug, either way worth a distributor's
  -- attention (captured in this session's metadata below).
  select coalesce(jsonb_agg(jsonb_build_object(
           'dailyPickId', dp.id,
           'growerCompanyId', dp.grower_company_id,
           'growerCompanyName', c.name,
           'status', dp.status
         )), '[]'::jsonb)
    into v_draft_picks
  from public.daily_picks dp
  join public.companies c on c.id = dp.grower_company_id
  where dp.trading_day_id = v_day.id
    and dp.status <> 'closed';

  -- Mass-close every pick for the day regardless of prior status —
  -- deliberately unconditional, matching the PRD's documented behavior
  -- ("does not filter by status").
  update public.daily_picks set status = 'closed', updated_at = now() where trading_day_id = v_day.id;

  update public.daily_arrangements
  set status = 'closed', closed_at = now()
  where trading_day_id = v_day.id;

  -- Clears the day's price-change signal, globally, per the source
  -- action's own scope ("every Product Variety") — not day-scoped data.
  update public.product_varieties set highlight_price_fluctuations = false
  where highlight_price_fluctuations = true;

  update public.trading_days set phase = 'closed', updated_at = now() where id = v_day.id;

  -- WhatsApp dispatch and final price population (source actions 3, 7,
  -- 8, 9) belong to the notifications/arrangement modules — later
  -- prompts, not this lifecycle engine's scope. What this function
  -- guarantees is the state machine: arrangement closed, picks closed,
  -- day terminated, all atomically.
  insert into public.lifecycle_sessions (trading_day_id, session_type, performed_by, metadata)
  values (v_day.id, 'end_the_day', (select auth.uid()), jsonb_build_object('draftPicksForceClosed', v_draft_picks))
  returning * into v_session;

  return v_session;
end;
$$;

comment on function public.close_arrangement() is
  'Backoffice-only. Phase 4 (terminal): closes the arrangement, mass-closes every Daily Pick for the day, clears price-fluctuation highlights, and logs an end_the_day session whose metadata lists any pick still open at close (Invariant 4). Raises P0007 if the day is not in phase "shop_closed".';

grant execute on function public.close_arrangement() to authenticated;

-- 5. submit_pick — grower-initiated, Draft -> Submitted.
create or replace function public.submit_pick(p_daily_pick_id uuid)
returns public.daily_picks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pick public.daily_picks;
begin
  select * into v_pick from public.daily_picks where id = p_daily_pick_id for update;
  if not found then
    raise exception 'NOT_FOUND: pick % does not exist', p_daily_pick_id using errcode = 'P0002';
  end if;

  if public.current_role() <> 'backoffice' and v_pick.grower_company_id <> public.current_company_id() then
    raise exception 'FORBIDDEN: not this pick''s grower' using errcode = '42501';
  end if;

  if v_pick.status <> 'draft' then
    raise exception 'INVALID_STATE: pick % is % — can only submit from draft', p_daily_pick_id, v_pick.status
      using errcode = 'P0007';
  end if;

  update public.daily_picks
  set status = 'submitted', submitted_at = now(), updated_at = now()
  where id = p_daily_pick_id
  returning * into v_pick;

  return v_pick;
end;
$$;

comment on function public.submit_pick(uuid) is
  'The owning grower (or backoffice). Draft -> Submitted on a Daily Pick. security definer: RLS grants growers no general write on daily_picks, so this function is the sole path, checking ownership and forward-only status itself. Raises P0007 if the pick is not currently in draft.';

grant execute on function public.submit_pick(uuid) to authenticated;

-- 6. update_pick_product_pallets — grower-initiated, arrangement-edit
--    floor check.
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
  v_pick_status public.daily_pick_status;
  v_arranged numeric;
begin
  if p_pallets_picked < 0 then
    raise exception 'INVALID_INPUT: pallets picked cannot be negative' using errcode = 'P0008';
  end if;

  -- plpgsql can't mix a composite target (`dpp.*`) with scalar targets in
  -- one INTO list, so the owning pick's fields are fetched as scalars
  -- here; the row itself comes back from the UPDATE ... RETURNING below.
  select dp.grower_company_id, dp.status
    into v_grower_company_id, v_pick_status
  from public.daily_pick_products dpp
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
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

  if p_pallets_picked < v_arranged then
    raise exception
      'CONFLICT: cannot reduce pallets picked to % — % pallets already arranged to customers for this line',
      p_pallets_picked, v_arranged
      using errcode = 'P0006';
  end if;

  update public.daily_pick_products
  set pallets_picked = p_pallets_picked, updated_at = now()
  where id = p_daily_pick_product_id
  returning * into v_line;

  return v_line;
end;
$$;

comment on function public.update_pick_product_pallets(uuid, numeric) is
  'The owning grower (or backoffice). Updates a Daily Pick Product line''s pallets_picked. security definer for the same reason as submit_pick. Enforces the arrangement-edit rule: pallets_picked can never drop below the sum already committed in arrangement_records for this line (raises P0006), and rejects edits once the parent pick is closed (P0007).';

grant execute on function public.update_pick_product_pallets(uuid, numeric) to authenticated;
