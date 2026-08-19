-- Fixes a real bug found while testing close_arrangement end to end:
-- Invariant 4's "surface a pick still open at phase 4" check used
-- `status <> 'closed'`, which matches BOTH 'draft' and 'submitted' picks
-- — since every pick is one or the other right up until the mass-close a
-- few statements later, this flagged every grower's pick as a no-show,
-- not just the genuine ones. 'submitted' at phase 4 is the normal,
-- expected case (Invariant 4: "Phase 3: Picks are in Submitted"); only a
-- pick still stuck in 'draft' is the noteworthy case worth surfacing.
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
