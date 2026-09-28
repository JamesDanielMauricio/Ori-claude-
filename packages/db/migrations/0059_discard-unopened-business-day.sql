-- Discard a trading day that was started by mistake — typically on the
-- wrong date — before its shop was ever opened.
--
-- "סגירת יום עסקים" was already offered for a day in phase 'initiated' (the
-- sidebar enables it as the "opened by mistake" bail-out), but the only
-- function behind it, close_arrangement, requires phase 'shop_closed' and
-- refused. And even a successful close would have left the day behind: a
-- closed day still occupies its date, so the right date could not simply be
-- started instead.
--
-- This deletes the day outright. Everything it owns goes with it through the
-- ON DELETE CASCADE foreign keys (0009, 0012, 0017, 0020) — verified against
-- the catalog of a database built from every migration, not assumed:
--
--   trading_days
--     ├─ daily_arrangements ── arrangement_records
--     ├─ daily_picks ── daily_pick_products ── arrangement_records
--     ├─ daily_orders ── daily_order_products ── arrangement_records
--     │               └─ order_submission_logs
--     ├─ daily_shops
--     ├─ lifecycle_sessions
--     └─ notification_outbox
--
-- No table references any of these without a foreign key, none of them has
-- a trigger, and starting a day (initiate_business_day → bootstrap_grower_pick)
-- writes nowhere else: the leftover carried into a new pick line is COPIED
-- from the grower's previous line, never moved, so no earlier day changes
-- when this one is removed. In-app alerts are not in the tree, and don't need
-- to be: the only thing that writes them during normal use is
-- close_arrangement, which a day in phase 'initiated' has never reached.
--
-- What deleting can't undo: the "business day open" WhatsApp message each
-- eligible grower was queued at initiate. Rows not yet sent are deleted with
-- the day and so are never sent; any already delivered stay delivered.

-- SECURITY: ALLOWS a backoffice user to delete ONE trading day, and only
-- while it is still in phase 'initiated' with no shop — i.e. before any
-- customer could have seen it or ordered on it. PROTECTS AGAINST deleting a
-- day that went live (opened, closed, or finished): those carry customers'
-- orders, arrangements and history, and stay closable only through the
-- normal forward-only lifecycle.
--
-- Security invoker, like the other day-lifecycle functions (initiate_business_day,
-- open_shop, close_shop, close_arrangement): the caller's own RLS still
-- applies, and trading_days_write_backoffice (0010) is what
-- lets a backoffice caller delete the row. The cascades then run as the
-- tables' owner, as Postgres always runs referential actions — which is why
-- one delete reaches the whole tree without a policy on each child table.
create or replace function public.discard_business_day(p_trading_day_id uuid)
returns public.trading_days
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
begin
  -- `is distinct from`, not `<>`: current_role() is NULL for a caller with no
  -- profile (anon, or a user whose profile row is gone), and `NULL <>
  -- 'backoffice'` is NULL, which an IF treats as false — the check would let
  -- them through. `is distinct from` is true for NULL, so they are refused.
  if public.current_role() is distinct from 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  -- The day is named by id, not taken as "whichever day is open" the way
  -- close_shop/close_arrangement do, so this deletes exactly the day the
  -- person confirmed in the dialog and nothing else. `for update` holds the
  -- row until this transaction ends: an open_shop racing this call waits,
  -- then finds no day at all — it can never open the shop of a day that is
  -- being deleted, nor can this delete a day whose shop just opened.
  select * into v_day from public.trading_days where id = p_trading_day_id for update;
  if not found then
    raise exception 'NOT_FOUND: trading day % does not exist', p_trading_day_id using errcode = 'P0002';
  end if;

  if v_day.phase <> 'initiated' then
    raise exception 'INVALID_STATE: only a trading day whose shop was never opened can be discarded — this one is in phase %', v_day.phase
      using errcode = 'P0007';
  end if;

  -- Belt and braces: open_shop creates the daily_shops row and moves the
  -- phase in one transaction, so 'initiated' already implies no shop. Checked
  -- anyway, because "the shop was never opened" is the whole condition that
  -- makes deleting safe, and this is the literal form of it.
  if exists (select 1 from public.daily_shops where trading_day_id = v_day.id) then
    raise exception 'INVALID_STATE: this trading day has a shop, so it was opened and cannot be discarded'
      using errcode = 'P0007';
  end if;

  delete from public.trading_days where id = v_day.id;
  -- RLS filters a delete silently rather than raising, so confirm it really
  -- happened instead of reporting success for a day that is still there.
  if not found then
    raise exception 'FORBIDDEN: the trading day could not be deleted' using errcode = '42501';
  end if;

  return v_day;
end;
$$;

comment on function public.discard_business_day(uuid) is
  'Backoffice-only. Deletes a trading day that was started but whose shop was never opened (phase initiated, no daily_shops row), together with everything it owns via ON DELETE CASCADE — arrangement, grower picks and pick lines, orders, lifecycle log and outbox rows — so its date can be started again. Returns the deleted row. Raises 42501 for a non-backoffice caller, P0002 if the day does not exist, P0007 if the day is in any phase other than initiated or has a shop.';

-- SECURITY: ALLOWS signed-in users (`authenticated`) and the service role to
-- call it — the function itself then refuses everyone but backoffice.
-- PROTECTS AGAINST anonymous callers reaching it at all: Postgres grants
-- EXECUTE on every new function to PUBLIC, and Supabase's default privileges
-- add `anon`, so both are revoked here (the same reasoning as 0055's revoke
-- on enqueue_backoffice_notification).
revoke execute on function public.discard_business_day(uuid) from public, anon;
grant execute on function public.discard_business_day(uuid) to authenticated, service_role;
