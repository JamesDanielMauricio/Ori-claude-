-- A pick line now keeps BOTH leftover figures, the way Bubble did:
--
--   leftover_pallets             what was carried in from earlier days —
--                                always, before AND after the day closes
--   end_of_day_leftover_pallets  what was left when the day closed
--                                (picked + carried in − arranged); empty
--                                while the day is still open
--
-- Until now there was one column for both. It held "carried in" while the day
-- was open, and close_out_pick_leftovers overwrote it with "left at the end"
-- when the day closed (0050). Every screen showing a past day had to know
-- which meaning it was looking at, and some didn't: a past day's arrangement
-- board, matrix and בשם מגדל showed 10 picked + 3 carried in − 8 arranged as
-- "7 left" instead of 5, and the pick editor's עודף box showed the end-of-day
-- figure as if it were the carry-in. With the two kept apart, every screen
-- reads leftover_pallets as "carried in" and is right on every day. It also
-- means closing out a day can no longer add the same pallets up twice.
--
-- What it does, in one transaction:
--   1. adds end_of_day_leftover_pallets (and 0069's "never NaN" rule for it);
--   2. splits every line of every CLOSED day: the value now stored moves to
--      end_of_day_leftover_pallets, and leftover_pallets gets back the
--      carried-in figure, worked out as  end of day − picked + arranged  —
--      the exact reverse of how close-out computed it. Lines already split
--      are skipped, so running this file twice changes nothing more. Today's
--      open day is not touched;
--   3. close_out_pick_leftovers writes the new column and leaves
--      leftover_pallets alone;
--   4. bootstrap_grower_pick and sync_grower_picks, which give a grower's new
--      line its carry-in, read it from the previous line's new column.
-- The next day's carry-in therefore comes out exactly as it does now.
--
-- RUN AFTER 0067: sync_grower_picks below is 0067's version (it keeps picked
-- lines) plus this change. Running 0067 after this file would put back the
-- old seeding.
--
-- Function bodies are copied unchanged from their latest definitions
-- (bootstrap_grower_pick and close_out_pick_leftovers from 0050,
-- sync_grower_picks from 0067) apart from the lines marked "0070" and the
-- security comments. Safe to run more than once.

alter table public.daily_pick_products
  add column if not exists end_of_day_leftover_pallets numeric(10, 2);

comment on column public.daily_pick_products.end_of_day_leftover_pallets is
  'Pallets left on this line when its trading day closed: pallets_picked + leftover_pallets (carried in) - arranged. Written by close_out_pick_leftovers; null while the day is open. The next day''s line carries this in as its leftover_pallets (migration 0070).';

-- STOCK: ALLOWS any ordinary number, or none while the day is open. PROTECTS
-- AGAINST a NaN end-of-day figure, which would carry into the next day and
-- make that product's stock NaN (see 0069).
alter table public.daily_pick_products
  drop constraint if exists daily_pick_products_end_of_day_leftover_is_a_number,
  add constraint daily_pick_products_end_of_day_leftover_is_a_number check (end_of_day_leftover_pallets <> 'NaN'::numeric);

-- The history split (2 above). Only closed days, only lines not split yet.
update public.daily_pick_products dpp
set end_of_day_leftover_pallets = dpp.leftover_pallets,
    leftover_pallets = dpp.leftover_pallets - dpp.pallets_picked + coalesce(
      (select sum(ar.quantity_pallets)
         from public.arrangement_records ar
        where ar.daily_pick_product_id = dpp.id),
      0
    )
from public.daily_picks dp
join public.trading_days td on td.id = dp.trading_day_id
where dp.id = dpp.daily_pick_id
  and td.phase = 'closed'
  and dpp.end_of_day_leftover_pallets is null;


create or replace function public.close_out_pick_leftovers(p_trading_day_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated integer;
begin
  -- SECURITY: ALLOWS a backoffice account to close out a day's leftovers. PROTECTS AGAINST a
  -- grower or customer calling it straight through the API (every signed-in
  -- account may execute it). A caller with no profile at all has a NULL role,
  -- and NULL <> 'backoffice' does not raise; that caller is stopped by
  -- row-level security instead, because this function runs as its caller
  -- (security invoker) and only backoffice may write the pick tables.
  -- Unchanged from 0050.
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  -- picked + whatever carried into today as leftover, minus arranged. Not
  -- just picked - arranged: today's own leftover_pallets already holds
  -- yesterday's carry-in (bootstrap_grower_pick / sync_grower_picks), and
  -- that has to fold into today's ending figure too, or unsold stock would
  -- quietly reset to just today's unarranged pick every time it closes.
  -- 0070: written to its own column. leftover_pallets (carried in) is left as
  -- it was, so this can never add up twice, and the day keeps both figures.
  update public.daily_pick_products dpp
  set end_of_day_leftover_pallets = dpp.pallets_picked + coalesce(dpp.leftover_pallets, 0) - coalesce(
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
  'Backoffice-only. Sets end_of_day_leftover_pallets = pallets_picked + leftover_pallets (carried in) - arranged (migration 0070; leftover_pallets itself is left unchanged), for every pick-product line belonging to the trading day''s picks. Called directly from close_arrangement (same transaction); also directly callable/testable on its own.';

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
  -- SECURITY: ALLOWS a backoffice account to create and re-sync a grower's pick for a day. PROTECTS AGAINST a
  -- grower or customer calling it straight through the API (every signed-in
  -- account may execute it). A caller with no profile at all has a NULL role,
  -- and NULL <> 'backoffice' does not raise; that caller is stopped by
  -- row-level security instead, because this function runs as its caller
  -- (security invoker) and only backoffice may write the pick tables.
  -- Unchanged from 0050.
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
    coalesce(v_prev.carry_forward, 0)
  from public.grower_products gp
  left join lateral (
    -- 0070: what was LEFT when that day closed is what carries in.
    select coalesce(dpp2.end_of_day_leftover_pallets, dpp2.leftover_pallets) as carry_forward
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
  'Backoffice-only. Idempotent: creates the grower''s Daily Pick for the day if absent, then upserts its pick-product lines to exactly match grower_products — existing lines (and their pallets_picked/leftover_pallets/comment) are preserved. A newly-created line seeds leftover_pallets from this same grower+variety''s most recent OTHER line''s end_of_day_leftover_pallets (migration 0070), so unsold stock carries forward across trading days. Lines for now-out-of-season products are pruned ONLY if untouched (pallets_picked = 0, leftover_pallets = 0, and no arrangement_records reference them). Safe to call any number of times.';

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
    coalesce(v_prev.carry_forward, 0)
  from public.daily_picks dp
  join public.grower_products gp on gp.company_id = dp.grower_company_id
  left join lateral (
    -- 0070: what was LEFT when that day closed is what carries in.
    select coalesce(dpp2.end_of_day_leftover_pallets, dpp2.leftover_pallets) as carry_forward
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
  'Backoffice-only. Re-syncs Daily Pick lines against the current in-season list for the open trading day: bootstraps newly-eligible growers, drops out-of-season lines ONLY if untouched (pallets_picked = 0, leftover_pallets = 0, and no arrangement_records reference them — migration 0067 added the pallets_picked condition, matching bootstrap_grower_pick), adds newly in-season lines — seeding leftover_pallets from this grower+variety''s most recent prior line''s end_of_day_leftover_pallets (migration 0070), same as bootstrap_grower_pick. Pass a grower company id to sync one grower, or null for all of them. No-op when no trading day is open. Does not change trading_days.phase.';
