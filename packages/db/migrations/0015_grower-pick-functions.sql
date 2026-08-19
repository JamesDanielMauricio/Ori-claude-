-- R3 + R6: the grower picking module's two named replacements for the
-- source's documented anti-patterns.
--
-- R3 — bootstrap_grower_pick replaces the real+temp record pair from
-- create-daily-pick-product-lines.md entirely. There is no `is_temp_record`
-- column anywhere in this schema. Idempotency comes from a real database
-- upsert on the natural key `(daily_pick_id, product_variety_id)` — an
-- `on conflict do nothing` that preserves whatever the grower already
-- entered — plus a prune step for lines whose product fell out of season,
-- which cascades to `arrangement_records` automatically (0012's
-- `on delete cascade`) instead of the source's separate rerun-only
-- arrangement-cleanup action. Calling this function twice with the same
-- inputs leaves the same state either time — a true idempotent operation,
-- not a check-then-write.
--
-- R6 — close_out_pick_leftovers replaces the three near-identically-named
-- workflows in leftover-pipeline.md (`update left overs` the trigger,
-- `update_leftovers` the computation, `update leftover data` the
-- propagation trigger) with one named function, called directly from
-- `close_arrangement`'s body — a plain SQL function call, not a queue or
-- a trigger relay. Since `close_arrangement` is already one transaction,
-- a function it calls runs inside that same transaction for free; no
-- extra mechanism is needed to get that guarantee.

-- 1. bootstrap_grower_pick — idempotent upsert-and-prune.
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
  -- (pallets_picked, pickup_time, comment) untouched — `do nothing`, not
  -- `do update`, is the whole point here.
  insert into public.daily_pick_products (daily_pick_id, product_variety_id)
  select v_pick.id, gp.product_variety_id
  from public.grower_products gp
  where gp.company_id = p_grower_company_id
  on conflict (daily_pick_id, product_variety_id) do nothing;

  -- Prune: a line whose product fell out of the grower's in-season list
  -- is removed — cascades to any arrangement_records referencing it
  -- (0012), which is what the source's separate rerun-only
  -- arrangement-cleanup action did as a distinct step.
  delete from public.daily_pick_products dpp
  where dpp.daily_pick_id = v_pick.id
    and not exists (
      select 1 from public.grower_products gp
      where gp.company_id = p_grower_company_id
        and gp.product_variety_id = dpp.product_variety_id
    );

  return v_pick;
end;
$$;

comment on function public.bootstrap_grower_pick(uuid, uuid) is
  'Backoffice-only. Idempotent: creates the grower''s Daily Pick for the day if absent, then upserts its pick-product lines to exactly match grower_products — existing lines (and their pallets_picked/pickup_time/comment) are preserved, lines for now-out-of-season products are pruned. Safe to call any number of times, including mid-day after the distributor changes a grower''s in-season list ("add products").';

grant execute on function public.bootstrap_grower_pick(uuid, uuid) to authenticated;

-- 2. close_out_pick_leftovers — one function, the whole leftover
--    computation, called directly from close_arrangement below.
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

  update public.daily_pick_products dpp
  set leftover_pallets = dpp.pallets_picked - coalesce(
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
  'Backoffice-only. Sets leftover_pallets = pallets_picked - arranged, for every pick-product line belonging to the trading day''s picks. Called directly from close_arrangement (same transaction); also directly callable/testable on its own.';

grant execute on function public.close_out_pick_leftovers(uuid) to authenticated;

-- 3. initiate_business_day — refactored to call bootstrap_grower_pick per
--    eligible grower instead of its own inline bootstrap INSERTs. Same
--    eligibility filter and Phase-1 behavior as before (0011); only the
--    per-grower bootstrap mechanism changed.
create or replace function public.initiate_business_day(p_trade_date date)
returns public.trading_days
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
  v_grower record;
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

  for v_grower in
    select c.id
    from public.companies c
    where c.type = 'grower'
      and c.status = 'active'
      and exists (select 1 from public.grower_products gp where gp.company_id = c.id)
  loop
    perform public.bootstrap_grower_pick(v_day.id, v_grower.id);
  end loop;

  return v_day;
end;
$$;

comment on function public.initiate_business_day(date) is
  'Backoffice-only. Phase 1: opens a new trading day, creates its Daily Arrangement, and bootstraps a Daily Pick (+ pick-product lines) for every active grower with a non-empty in-season list, via bootstrap_grower_pick. Raises P0004 if a trading day is already open (Lifecycle Invariant 1 / the concurrency guard).';

-- 4. close_arrangement — adds one line calling close_out_pick_leftovers,
--    after the mass pick-close and before the session log, in the same
--    transaction as everything else this function already does.
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
    and dp.status = 'draft';

  update public.daily_picks set status = 'closed', updated_at = now() where trading_day_id = v_day.id;

  -- R6: one direct call, same transaction — see this file's header.
  perform public.close_out_pick_leftovers(v_day.id);

  update public.daily_arrangements
  set status = 'closed', closed_at = now()
  where trading_day_id = v_day.id;

  update public.product_varieties set highlight_price_fluctuations = false
  where highlight_price_fluctuations = true;

  update public.trading_days set phase = 'closed', updated_at = now() where id = v_day.id;

  insert into public.lifecycle_sessions (trading_day_id, session_type, performed_by, metadata)
  values (v_day.id, 'end_the_day', (select auth.uid()), jsonb_build_object('draftPicksForceClosed', v_draft_picks))
  returning * into v_session;

  return v_session;
end;
$$;

comment on function public.close_arrangement() is
  'Backoffice-only. Phase 4 (terminal): closes the arrangement, mass-closes every Daily Pick for the day, computes end-of-day leftovers (close_out_pick_leftovers), clears price-fluctuation highlights, and logs an end_the_day session whose metadata lists any pick still open at close (Invariant 4). Raises P0007 if the day is not in phase "shop_closed".';

-- 5. update_pick_product_details — the grower's comment + pickup-time
--    override. Kept separate from update_pick_product_pallets (which
--    already exists and is already tested): that function's job is the
--    arrangement-edit floor check, specific to quantity; this one edits
--    fields the floor check has no opinion on.
create or replace function public.update_pick_product_details(
  p_daily_pick_product_id uuid,
  p_pickup_time time,
  p_comment text
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
begin
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

  update public.daily_pick_products
  set pickup_time = p_pickup_time, comment = p_comment, updated_at = now()
  where id = p_daily_pick_product_id
  returning * into v_line;

  return v_line;
end;
$$;

comment on function public.update_pick_product_details(uuid, time, text) is
  'The owning grower (or backoffice). Updates a Daily Pick Product line''s pickup_time override and comment. security definer for the same reason as update_pick_product_pallets/submit_pick. Rejects edits once the parent pick is closed (P0007).';

grant execute on function public.update_pick_product_details(uuid, time, text) to authenticated;

-- 6. send_pick_reminder — the distributor's "remind this grower" action
--    on the Grower Inventory Status screen.
create or replace function public.send_pick_reminder(p_daily_pick_id uuid)
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

  select * into v_pick from public.daily_picks where id = p_daily_pick_id for update;
  if not found then
    raise exception 'NOT_FOUND: pick % does not exist', p_daily_pick_id using errcode = 'P0002';
  end if;

  if v_pick.status = 'closed' then
    raise exception 'INVALID_STATE: cannot send a reminder about a closed pick' using errcode = 'P0007';
  end if;

  update public.daily_picks
  set reminder_sent_at = now()
  where id = p_daily_pick_id
  returning * into v_pick;

  return v_pick;
end;
$$;

comment on function public.send_pick_reminder(uuid) is
  'Backoffice-only. Stamps reminder_sent_at on the grower''s Daily Pick — a real, persisted signal. Does not dispatch WhatsApp (no integration exists yet; see the notifications module). Raises P0007 if the pick is already closed.';

grant execute on function public.send_pick_reminder(uuid) to authenticated;
