-- The distributor can now un-submit a grower's pick from the arrangement
-- board (a truck icon beside the pencil, in GrowerSupplyColumn), Submitted
-- -> Draft, while the trading day is still open. This is a deliberate
-- reversal of the pick status state machine's previous forward-only rule
-- (reference/prd/state-machines/pick-status-state-machine.md: "No backward
-- transitions exist in any UI") — a later, explicit product decision, not
-- an oversight in the earlier one. See docs/SCHEMA_DECISIONS.md.
--
-- Symmetric with submit_pick clearing what submit_pick set: status back to
-- 'draft', submitted_at back to null, and pickup_time back to null (the
-- snapshot from migration 0043 — a re-submission later will re-snapshot
-- whatever the company's default is AT THAT POINT, which is the whole
-- point of it being a snapshot rather than a live join).
--
-- Backoffice-only, unlike submit_pick's "the owning grower, or backoffice"
-- — this is a distributor-side arrangement-board control, not something
-- exposed on the grower's own picking screen.
create or replace function public.revert_pick_to_draft(p_daily_pick_id uuid)
returns public.daily_picks
language plpgsql
security definer
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

  -- A pick can only be 'submitted' while the trading day is still open —
  -- close_arrangement mass-closes every pick for the day to 'closed', so by
  -- the time the day is closed nothing is left in 'submitted' to revert.
  -- This check is therefore sufficient on its own; no separate day-phase
  -- check is needed.
  if v_pick.status <> 'submitted' then
    raise exception 'INVALID_STATE: pick % is % — can only revert to draft from submitted', p_daily_pick_id, v_pick.status
      using errcode = 'P0007';
  end if;

  update public.daily_picks
  set status = 'draft', submitted_at = null, pickup_time = null, updated_at = now()
  where id = p_daily_pick_id
  returning * into v_pick;

  return v_pick;
end;
$$;

comment on function public.revert_pick_to_draft(uuid) is
  'Backoffice-only. Submitted -> Draft on a Daily Pick — the arrangement board''s truck-icon toggle, and a deliberate exception to this module''s otherwise forward-only status transitions (see migration 0043''s header and docs/SCHEMA_DECISIONS.md). Clears submitted_at and the pickup_time snapshot back to null, so a later re-submission captures the company''s default fresh. Raises P0007 if the pick is not currently submitted (in particular, a closed pick can never be reverted).';

grant execute on function public.revert_pick_to_draft(uuid) to authenticated;

-- close_arrangement: same () signature, one more field in the mass
-- pick-close. A pick force-closed straight from Draft (a no-show grower,
-- or one the distributor reverted with the truck icon and never
-- re-submitted) now also gets submitted_at backfilled to the moment of
-- closing, symmetric with 0043's pickup_time backfill — so "was this ever
-- actually submitted" reads as a real timestamp for every closed pick,
-- not null for the ones that got here without a submit_pick call.
-- coalesce leaves an already-submitted pick's own timestamp untouched.
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
      submitted_at = coalesce(dp.submitted_at, now()),
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
  'Backoffice-only. Phase 4 (terminal), one transaction: mass-closes every Daily Pick (backfilling pickup_time and submitted_at for any pick that never went through submit_pick — see migrations 0043/0044), computes end-of-day leftovers, populates arrangement prices, closes the arrangement, clears price-fluctuation highlights, closes the trading day, writes the notification outbox, and logs an end_the_day session — all in the same function call, so a failure at any step (e.g. an unpriceable variety) rolls back every step before it. Raises P0007 if the day is not in phase "shop_closed", or if any arrangement record can''t be priced.';
