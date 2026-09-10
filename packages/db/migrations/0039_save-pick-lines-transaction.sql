-- Makes saving a Daily Pick's lines ONE transaction (R4).
--
-- THE BUG. The grower's picking screen, and the distributor's Grower Inventory
-- Status screen that shares its editor, both saved by firing one RPC per
-- changed field group and awaiting them together:
--
--   Promise.all([ update_pick_product_pallets(lineA, ...),
--                 update_pick_product_details(lineA, ...),
--                 update_pick_product_pallets(lineB, ...), ... ])
--
-- Each of those is its own transaction. A grower editing ten lines and pressing
-- Save issued up to twenty independent writes, and any one of them could fail
-- on its own — a dropped connection partway through, or the P0006
-- already-arranged floor check rejecting a single line — while the rest
-- committed. The screen then showed one error toast over a table that had been
-- partly written, with no indication of which lines had landed. R4 is explicit
-- that partial failure must be unobservable; this was the opposite, on the
-- screen growers use every day.
--
-- THE FIX. One function, one transaction, all lines. Either the whole save
-- commits or none of it does, and the P0006 rejection that used to half-apply a
-- save now rejects it whole, leaving the grower's on-screen draft matching the
-- database exactly.
--
-- The two per-line functions are deliberately NOT dropped. They remain the
-- correct surface for a genuine single-line edit, they are covered by existing
-- tests, and update_pick_product_pallets in particular is called from elsewhere.
-- This adds the batch path the editor needs; it does not remove the granular one.

-- p_lines shape: [{ "dailyPickProductId": uuid,
--                   "palletsPicked": number,
--                   "pickupTime": "HH:MM" | null,
--                   "comment": string | null }, ...]
--
-- Every line carries its FULL desired state, not a diff. The caller holds that
-- state already (it is the on-screen draft), and it means this function decides
-- what actually changed by comparing against the stored row rather than
-- trusting the client to have worked it out — which is what keeps the
-- notification below firing on a real change and not on a no-op save.
--
-- SECURITY: security definer, matching update_pick_product_pallets and
-- update_pick_product_details, and for the same reason those two are — the
-- function has to read arrangement_records (rows belonging to OTHER companies'
-- allocations) to enforce the floor check, which the calling grower cannot and
-- should not be able to read directly under RLS. Definer rights are therefore
-- load-bearing, not convenience, and every check the per-line functions made is
-- reproduced below rather than inherited: caller must be backoffice or the
-- pick's own grower, the pick must not be closed, and — new here, because a
-- batch takes a list of ids the per-line functions never had to cross-check —
-- every line id must actually belong to the pick named in p_daily_pick_id.
-- Without that last one, a grower could pass their own pick id alongside line
-- ids from someone else's pick and write to another company's rows.
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
  v_pickup_time time;
  v_comment text;
  v_existing public.daily_pick_products;
  v_arranged numeric;
  v_any_pallets_changed boolean := false;
begin
  v_is_grower_initiated := public.current_role() = 'grower';

  -- The parent pick is locked once, up front. Every line in the batch hangs off
  -- it, so one lock serializes the whole save against a concurrent close_pick
  -- or a second editor, and the ownership/status checks are answered once
  -- instead of re-derived per line.
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
    -- An empty string is the browser's "time input left blank", which means
    -- "no override", not midnight — the same nullif() treatment the comment
    -- gets, and the same shape update_pick_product_details already accepted.
    v_pickup_time := nullif(v_line ->> 'pickupTime', '')::time;
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

    -- The check a per-line function never needed. p_daily_pick_id was already
    -- authorized above; this is what stops a caller pairing that authorized id
    -- with line ids belonging to a different grower's pick.
    if v_existing.daily_pick_id <> p_daily_pick_id then
      raise exception 'FORBIDDEN: pick product line % does not belong to daily pick %',
        v_line_id, p_daily_pick_id using errcode = '42501';
    end if;

    -- The arrangement-edit floor, preserved verbatim from
    -- update_pick_product_pallets: a grower may not retract supply the
    -- distributor has already committed to customers. Evaluated only when the
    -- quantity actually changed, so re-saving an untouched line can never fail
    -- on a floor that was already breached by someone else's later allocation.
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
        pickup_time = v_pickup_time,
        comment = v_comment,
        updated_at = now()
    where id = v_line_id;
  end loop;

  -- ONE pick_updated alert per save, not one per changed line.
  --
  -- This is the single behavioral difference from the per-line path, and it is
  -- forced by batching rather than chosen freely: with one RPC there is no
  -- longer a per-RPC event to hang a notification on. The old shape enqueued an
  -- identical row (same trade date, same company, empty lines array) for every
  -- changed line, so a grower revising ten products handed backoffice ten
  -- indistinguishable copies of "this grower updated their pick" for what was,
  -- to the person doing it, a single press of Save. One row per save is what
  -- that user action always meant.
  --
  -- Still gated on the grower being the actor: backoffice editing a pick on the
  -- grower's behalf (the Grower Inventory Status screen) must not notify
  -- backoffice about backoffice's own action. Same rule as 0031, unchanged.
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
  'The owning grower (or backoffice). Saves every line of one Daily Pick in a single transaction: pallets_picked, pickup_time and comment per line, all-or-nothing. Replaces the editor''s previous fan-out of one update_pick_product_pallets/update_pick_product_details call per line, which could commit some lines and fail others. Enforces the same rules as those functions (P0002 unknown pick/line, 42501 wrong grower or a line not belonging to this pick, P0007 closed pick, P0008 negative quantity, P0006 arrangement floor) and enqueues at most one pick_updated backoffice notification per save when the grower themselves changed a quantity. Returns the pick''s full line set as saved.';

grant execute on function public.save_pick_lines(uuid, jsonb) to authenticated;
