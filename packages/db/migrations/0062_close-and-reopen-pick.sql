-- The arrangement board's truck icon closes a grower's pick, and pressing it
-- again puts the pick back the way it was.
--
-- Until now the truck was wired to Draft <-> Submitted: it lit up whenever
-- daily_picks.status was 'submitted', and pressing it called submit_pick /
-- revert_pick_to_draft. But 'submitted' is also what a save moves a pick to —
-- the grower's own "שמור" and, since the distributor's "שמור" on "בשם מגדל"
-- was made to send as well, theirs too. So every save that sent a pick also
-- lit its truck, though nobody had pressed it.
--
-- The truck now owns the third status instead. A save moves a pick
-- Draft -> Submitted and can never reach Closed; the truck moves it to Closed
-- and back:
--
--   press the truck on a Draft or Submitted pick   -> the pick becomes Closed
--   press it again while the day is still running  -> the pick goes back to
--                                                     whatever it was before
--
-- What a Closed pick already meant, and still does: the grower and the
-- distributor's pencil can no longer edit its lines (save_pick_lines and its
-- siblings refuse with P0007), and no reminder can be sent about it. What it
-- does NOT stop: arranging against its stock, and customers' orders — both are
-- gated by the trading day's phase, not by a pick's status — and
-- close_arrangement, which still closes every pick when the day ends.
--
-- "Back to what it was" is not stored anywhere: it is worked out from
-- submitted_at. submit_pick sets it and revert_pick_to_draft clears it, and
-- they are the only two things that write it during a running day
-- (close_arrangement backfills it at the very end, when nothing can be
-- reopened any more). Closing a pick leaves it, and pickup_time, untouched. So
-- a pick with a submitted_at was Submitted when it was closed, and one
-- without was still a Draft — which is why no "status before close" column is
-- needed.
--
-- This replaces an earlier draft of this migration that gave the truck a
-- separate marker (a truck_marked_at column and a set_pick_truck function).
-- That draft was never released; the two statements below remove it if it was
-- ever run, and do nothing if it was not.
drop function if exists public.set_pick_truck(uuid, boolean);
alter table public.daily_picks drop column if exists truck_marked_at;

-- Closes (p_closed = true) or reopens (false) one grower's pick for the day.
-- The caller says which state they want rather than "flip it", so two clicks
-- racing each other (a double-click, or two distributors) end in a state
-- somebody asked for instead of cancelling out.
--
-- SECURITY: ALLOWS a backoffice user to close or reopen any pick whose trading
-- day has not been closed. PROTECTS AGAINST a grower or customer closing (and
-- so locking) the distributor's picks, and against rewriting a finished day —
-- once close_arrangement has closed the day, every pick is Closed for good
-- and no call here can reopen one.
--
-- Security INVOKER, unlike submit_pick / revert_pick_to_draft. Those had to be
-- definer because a grower has no write access to daily_picks and submit_pick
-- had to act for them. Nobody but backoffice needs to write here, and
-- backoffice can already update daily_picks under daily_picks_write_backoffice
-- (0010) — so the function borrows no extra rights and the policy stays the
-- last line of defence behind the role check.
create or replace function public.set_pick_closed(p_daily_pick_id uuid, p_closed boolean)
returns public.daily_picks
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pick public.daily_picks;
  v_phase public.trading_day_phase;
begin
  -- `is distinct from`, not `<>`: current_role() is NULL for a caller with no
  -- profile, and `NULL <> 'backoffice'` is NULL, which an IF treats as false —
  -- the check would let them through. `is distinct from` is true for NULL, so
  -- they are refused.
  if public.current_role() is distinct from 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  -- A null would fall through the `=` comparison below as "unknown" and end
  -- up reopening the pick, which is not something anyone asked for.
  if p_closed is null then
    raise exception 'INVALID_INPUT: p_closed must be true or false' using errcode = 'P0008';
  end if;

  select * into v_pick from public.daily_picks where id = p_daily_pick_id for update;
  if not found then
    raise exception 'NOT_FOUND: pick % does not exist', p_daily_pick_id using errcode = 'P0002';
  end if;

  -- A pick can be Closed for two different reasons: the distributor pressed the
  -- truck (undoable), or close_arrangement closed the day (final). The day's
  -- phase is what tells them apart — it is 'closed' only once the day has
  -- ended — so once it is, no pick is opened or closed any more. Read after the
  -- pick's row lock above, so a close_arrangement running at the same moment
  -- has either finished (and is seen here) or is waiting for this call.
  select phase into v_phase from public.trading_days where id = v_pick.trading_day_id;
  if v_phase = 'closed' then
    raise exception 'INVALID_STATE: the trading day of pick % has ended — its picks can no longer be closed or reopened', p_daily_pick_id
      using errcode = 'P0007';
  end if;

  -- Already in the state that was asked for: nothing to write. Skipping the
  -- update also skips the live-updates broadcast (0060) it would send to every
  -- open screen.
  if (v_pick.status = 'closed') = p_closed then
    return v_pick;
  end if;

  update public.daily_picks
  set status = case
        when p_closed then 'closed'::public.daily_pick_status
        when v_pick.submitted_at is not null then 'submitted'::public.daily_pick_status
        else 'draft'::public.daily_pick_status
      end,
      updated_at = now()
  where id = p_daily_pick_id
  returning * into v_pick;

  -- Row level security filters an UPDATE silently instead of raising, so
  -- confirm it really happened rather than reporting success for a change that
  -- was never made.
  if not found then
    raise exception 'FORBIDDEN: the pick could not be updated' using errcode = '42501';
  end if;

  return v_pick;
end;
$$;

comment on function public.set_pick_closed(uuid, boolean) is
  'Backoffice-only. Closes (p_closed = true) or reopens (false) one Daily Pick during a running trading day — the arrangement board''s truck icon. Closing sets status to closed and leaves submitted_at and pickup_time alone; reopening restores submitted if the pick has a submitted_at and draft if not, which is exactly what it was before it was closed. A closed pick refuses further edits and reminders (save_pick_lines etc., send_pick_reminder) but can still be arranged against. Idempotent: asking for the state the pick already has changes nothing and sends no live update. Returns the pick. Raises 42501 for a non-backoffice caller, P0008 for a null p_closed, P0002 if the pick does not exist, P0007 once its trading day has ended.';

-- SECURITY: ALLOWS signed-in users (`authenticated`) and the service role to
-- call it — the function itself then refuses everyone but backoffice.
-- PROTECTS AGAINST anonymous callers reaching it at all: Postgres grants
-- EXECUTE on every new function to PUBLIC, and Supabase's default privileges
-- add `anon`, so both are revoked here (the same reasoning as 0055's revoke
-- on enqueue_backoffice_notification, and 0059's on discard_business_day).
revoke execute on function public.set_pick_closed(uuid, boolean) from public, anon;
grant execute on function public.set_pick_closed(uuid, boolean) to authenticated, service_role;
