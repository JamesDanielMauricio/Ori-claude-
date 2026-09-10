-- Pickup time is a per-grower (company) setting, not a per-product one.
--
-- `daily_pick_products.pickup_time` (0014) was modeled as an optional
-- per-line override of `companies.default_pickup_time` — a real, but
-- wrong, business shape: a grower has ONE collection time for the whole
-- day, not one per variety on their pick. This migration removes the
-- per-line field and its editing surface entirely.
--
-- In its place, `daily_picks` (one row per grower per trading day) gets
-- its own `pickup_time` — not a duplicate of `companies.default_pickup_time`,
-- but a SNAPSHOT of it, taken the moment the pick leaves Draft. Without a
-- snapshot, a past day's record would silently change if the distributor
-- later edits the grower's default — exactly the "can we see the pickup
-- time of past records" gap this migration closes. Two moments write it:
--
--   1. `submit_pick` (the grower's own Draft -> Submitted action) — the
--      normal path.
--   2. `close_arrangement`'s mass pick-close — a pick that never got
--      submitted (a no-show grower, force-closed at end of day per
--      Invariant 4) never goes through submit_pick, so it needs the same
--      snapshot taken at that point instead. Guarded with `coalesce` so a
--      pick that WAS submitted keeps the time it already captured.

alter table public.daily_picks add column pickup_time time;

comment on column public.daily_picks.pickup_time is
  'Snapshot of companies.default_pickup_time at the moment this pick left draft (submit_pick, or force-closed by close_arrangement) — preserves the grower''s collection time as it stood for THIS day''s record even if the company''s default changes later. Null while still in draft; the UI reads the live company default until then.';

alter table public.daily_pick_products drop column pickup_time;

-- update_pick_product_details: drop the pickup_time parameter. Signature
-- change, so the old 3-arg overload is dropped explicitly first —
-- `create or replace` only replaces a function whose argument list matches
-- exactly (see docs/SCHEMA_DECISIONS.md's "a real, silent bug found" entry
-- for what happens if that step is skipped).
drop function if exists public.update_pick_product_details(uuid, time, text);

create or replace function public.update_pick_product_details(
  p_daily_pick_product_id uuid,
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
  set comment = p_comment, updated_at = now()
  where id = p_daily_pick_product_id
  returning * into v_line;

  return v_line;
end;
$$;

comment on function public.update_pick_product_details(uuid, text) is
  'The owning grower (or backoffice). Updates a Daily Pick Product line''s comment. Pickup time moved to daily_picks.pickup_time (a per-grower, not per-product, setting) — see migration 0043. security definer for the same reason as update_pick_product_pallets/submit_pick. Rejects edits once the parent pick is closed (P0007).';

grant execute on function public.update_pick_product_details(uuid, text) to authenticated;

-- save_pick_lines: same (uuid, jsonb) signature, so a plain create-or-
-- replace is safe here — only the body changes, dropping pickup_time from
-- each line's shape and from the update statement.
--
-- p_lines shape: [{ "dailyPickProductId": uuid,
--                   "palletsPicked": number,
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
  v_comment text;
  v_existing public.daily_pick_products;
  v_arranged numeric;
  v_any_pallets_changed boolean := false;
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
    v_comment := nullif(v_line ->> 'comment', '');

    if v_pallets is null then
      raise exception 'INVALID_INPUT: pallets picked is required for line %', v_line_id using errcode = 'P0008';
    end if;

    if v_pallets < 0 then
      raise exception 'INVALID_INPUT: pallets picked cannot be negative' using errcode = 'P0008';
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

    if v_pallets <> v_existing.pallets_picked then
      select coalesce(sum(quantity_pallets), 0) into v_arranged
      from public.arrangement_records
      where daily_pick_product_id = v_line_id;

      if v_pallets < v_arranged then
        raise exception
          'CONFLICT: cannot reduce pallets picked to % — % pallets already arranged to customers for this line',
          v_pallets, v_arranged
          using errcode = 'P0006';
      end if;

      v_any_pallets_changed := true;
    end if;

    update public.daily_pick_products
    set pallets_picked = v_pallets,
        comment = v_comment,
        updated_at = now()
    where id = v_line_id;
  end loop;

  if v_is_grower_initiated and v_any_pallets_changed then
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
  'The owning grower (or backoffice). Saves every line of one Daily Pick in a single transaction: pallets_picked and comment per line, all-or-nothing. Pickup time moved to daily_picks.pickup_time (see migration 0043) — no longer part of a line''s shape. Enforces the same rules as before (P0002 unknown pick/line, 42501 wrong grower or a line not belonging to this pick, P0007 closed pick, P0008 negative quantity, P0006 arrangement floor) and enqueues at most one pick_updated backoffice notification per save when the grower themselves changed a quantity. Returns the pick''s full line set as saved.';

grant execute on function public.save_pick_lines(uuid, jsonb) to authenticated;

-- submit_pick: same (uuid) signature. Adds the pickup_time snapshot —
-- copies the grower's CURRENT company default in at the moment of
-- submission, so this pick's record keeps that value even if the
-- company's default is edited afterward.
create or replace function public.submit_pick(p_daily_pick_id uuid)
returns public.daily_picks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pick public.daily_picks;
  v_pickup_time time;
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

  select default_pickup_time into v_pickup_time
  from public.companies
  where id = v_pick.grower_company_id;

  update public.daily_picks
  set status = 'submitted', submitted_at = now(), pickup_time = v_pickup_time, updated_at = now()
  where id = p_daily_pick_id
  returning * into v_pick;

  return v_pick;
end;
$$;

comment on function public.submit_pick(uuid) is
  'The owning grower (or backoffice). Draft -> Submitted on a Daily Pick, snapshotting the grower company''s current default_pickup_time onto this pick''s own pickup_time column (see migration 0043) so a later edit to the company default cannot rewrite this day''s historical record. security definer: RLS grants growers no general write on daily_picks, so this function is the sole path, checking ownership and forward-only status itself. Raises P0007 if the pick is not currently in draft.';

grant execute on function public.submit_pick(uuid) to authenticated;

-- close_arrangement: same () signature. The mass pick-close now also
-- backfills pickup_time for any pick reaching Closed without ever passing
-- through submit_pick (a no-show grower, per Invariant 4) — coalesce
-- leaves an already-submitted pick's own snapshot untouched.
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

  update public.daily_picks dp
  set status = 'closed',
      pickup_time = coalesce(dp.pickup_time, c.default_pickup_time),
      updated_at = now()
  from public.companies c
  where dp.trading_day_id = v_day.id
    and c.id = dp.grower_company_id;

  -- R6: one direct call, same transaction — see 0015's header.
  perform public.close_out_pick_leftovers(v_day.id);

  -- R4: price population is part of this same transaction, not a
  -- separately triggered step that can desync from the status change.
  -- Raises (and rolls back everything above) if any arrangement record
  -- can't be priced.
  perform public.populate_arrangement_prices(v_day.id);

  update public.daily_arrangements
  set status = 'closed', closed_at = now()
  where trading_day_id = v_day.id;

  update public.product_varieties set highlight_price_fluctuations = false
  where highlight_price_fluctuations = true;

  update public.trading_days set phase = 'closed', updated_at = now() where id = v_day.id;

  -- R4's external-system carve-out: this writes a durable outbox row,
  -- never an outbound HTTP call, so it's safe inside this transaction —
  -- see build_notification_outbox's own comment.
  perform public.build_notification_outbox(v_day.id);

  insert into public.lifecycle_sessions (trading_day_id, session_type, performed_by, metadata)
  values (v_day.id, 'end_the_day', (select auth.uid()), jsonb_build_object('draftPicksForceClosed', v_draft_picks))
  returning * into v_session;

  return v_session;
end;
$$;

comment on function public.close_arrangement() is
  'Backoffice-only. Phase 4 (terminal), one transaction: mass-closes every Daily Pick (backfilling pickup_time from the grower''s current company default for any pick that never went through submit_pick — see migration 0043), computes end-of-day leftovers, populates arrangement prices, closes the arrangement, clears price-fluctuation highlights, closes the trading day, writes the notification outbox, and logs an end_the_day session — all in the same function call, so a failure at any step (e.g. an unpriceable variety) rolls back every step before it. Raises P0007 if the day is not in phase "shop_closed", or if any arrangement record can''t be priced.';
