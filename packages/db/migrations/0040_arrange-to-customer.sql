-- Arrangement board: allocating to a customer who never ordered.
--
-- The arrangement screen now lets the distributor pick one grower's pick
-- line and work down the customer list, and the customer list is split in
-- two: those who ordered that variety, and those who did not. Pushing
-- surplus onto someone in the second group is an explicit, everyday action
-- there — and nothing in the schema could express it, because an
-- arrangement record has to point at a `daily_order_products` row and no
-- such row exists for a customer who never asked for the product.
--
-- Three changes, in dependency order:
--
--   1. `check_arrangement_allocation` — the demand-side ceiling now applies
--      only to lines the customer actually ordered.
--   2. `submit_order` — its prune no longer destroys a line that an
--      arrangement record points at.
--   3. `arrange_to_customer` — the new write the board's ✓ button calls.
--
-- NOT YET APPLIED. Run with `pnpm db:migrate`.

-- ---------------------------------------------------------------------------
-- 1. check_arrangement_allocation
-- ---------------------------------------------------------------------------
-- Identical to 0021's version except for the demand-side branch, which is
-- now skipped when the order line holds zero pallets.
--
-- The supply-side ceiling is physics: you cannot arrange produce a grower
-- did not pick, so it stays absolute. The demand-side ceiling is a
-- preference — "don't send a customer more than they asked for" — and
-- `pallets_ordered = 0` is precisely the case where the customer asked for
-- nothing at all and the distributor is deciding to send some anyway. A
-- ceiling of zero would make that impossible: every positive quantity
-- exceeds it, so the record could neither be created nor, afterwards, ever
-- be edited again.
--
-- This is deliberately scoped so no existing path changes behaviour. A
-- zero-pallet order line cannot occur today: `submit_order` skips zero
-- lines outright (`if v_pallets = 0 then continue`) and prunes anything it
-- did not keep, and it is the only writer of that table besides the new
-- function below. Every line that exists right now has
-- `pallets_ordered > 0` and therefore takes the identical branch it always
-- did.
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
  v_pallets_ordered numeric;
  v_supply_arranged numeric;
  v_demand_arranged numeric;
begin
  if p_quantity_pallets <= 0 then
    raise exception 'INVALID_INPUT: quantity must be positive' using errcode = 'P0008';
  end if;

  select pallets_picked into v_pallets_picked
  from public.daily_pick_products where id = p_daily_pick_product_id;

  select coalesce(sum(quantity_pallets), 0) into v_supply_arranged
  from public.arrangement_records
  where daily_pick_product_id = p_daily_pick_product_id
    and (p_excluding_record_id is null or id <> p_excluding_record_id);

  if v_supply_arranged + p_quantity_pallets > v_pallets_picked then
    raise exception 'OVER_ALLOCATION: % pallets already arranged + % requested exceeds % pallets picked on this line',
      v_supply_arranged, p_quantity_pallets, v_pallets_picked
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
  'Internal. Raises P0009 if arranging p_quantity_pallets would exceed the pick line''s pallets_picked, summed against every OTHER arrangement_records row referencing it. The same ceiling is applied to the order line''s pallets_ordered ONLY when that value is greater than zero: a zero-pallet order line is one arrange_to_customer created for a customer who never ordered the variety, and exists solely to carry a distributor push. Shared by create_arrangement_record, update_arrangement_record and arrange_to_customer so the rule can''t drift between them.';

-- ---------------------------------------------------------------------------
-- 2. submit_order
-- ---------------------------------------------------------------------------
-- Byte-for-byte 0032's definition apart from the prune step, which is
-- commented in place below. Reproduced in full because `create or replace
-- function` has no way to patch one statement.
create or replace function public.submit_order(
  p_trading_day_id uuid,
  p_lines jsonb,
  p_customer_company_id uuid default null
)
returns public.daily_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.daily_orders;
  v_phase public.trading_day_phase;
  v_trade_date date;
  v_line jsonb;
  v_kept_ids uuid[] := '{}';
  v_line_id uuid;
  v_pallets numeric;
  v_comment text;
  v_variety_id uuid;
  v_customer_company_id uuid;
  v_customer_company_name text;
  v_direct_customer_submission boolean;
  v_touched_variety_ids uuid[];
  v_demand_before_snapshot jsonb;
  v_demand_before numeric;
  v_demand_after numeric;
  v_supply numeric;
  v_overbooking numeric;
  v_product_name text;
  v_remaining numeric;
begin
  v_direct_customer_submission := p_customer_company_id is null and public.current_role() = 'customer';

  if p_customer_company_id is not null then
    if public.current_role() <> 'backoffice' then
      raise exception 'FORBIDDEN: only backoffice may submit an order on another company''s behalf' using errcode = '42501';
    end if;
    v_customer_company_id := p_customer_company_id;
  else
    if public.current_role() <> 'customer' then
      raise exception 'FORBIDDEN: customer role required' using errcode = '42501';
    end if;
    v_customer_company_id := public.current_company_id();
  end if;

  select phase, trade_date into v_phase, v_trade_date from public.trading_days where id = p_trading_day_id;
  if not found then
    raise exception 'NOT_FOUND: trading day % does not exist', p_trading_day_id using errcode = 'P0002';
  end if;
  if v_phase = 'closed' then
    raise exception 'INVALID_STATE: cannot submit an order once the trading day is closed' using errcode = 'P0007';
  end if;

  select * into v_order
  from public.daily_orders
  where trading_day_id = p_trading_day_id
    and customer_company_id = v_customer_company_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: no daily order exists for this company on this trading day' using errcode = 'P0002';
  end if;

  -- Snapshot demand-before for every variety this call could possibly
  -- push across a threshold, BEFORE the upsert loop touches anything.
  select array_agg(distinct (line ->> 'productVarietyId')::uuid)
  into v_touched_variety_ids
  from jsonb_array_elements(p_lines) as line
  where (line ->> 'palletsOrdered')::numeric > 0;

  select jsonb_object_agg(v.variety_id::text, coalesce(d.total, 0))
  into v_demand_before_snapshot
  from unnest(coalesce(v_touched_variety_ids, '{}'::uuid[])) as v(variety_id)
  left join lateral (
    select sum(dop.pallets_ordered) as total
    from public.daily_order_products dop
    join public.daily_orders do2 on do2.id = dop.daily_order_id
    where do2.trading_day_id = p_trading_day_id
      and dop.product_variety_id = v.variety_id
  ) d on true;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_pallets := (v_line ->> 'palletsOrdered')::numeric;
    v_comment := nullif(v_line ->> 'comment', '');
    v_variety_id := (v_line ->> 'productVarietyId')::uuid;

    if v_pallets < 0 then
      raise exception 'INVALID_INPUT: pallets ordered cannot be negative' using errcode = 'P0008';
    end if;

    if v_pallets = 0 then
      continue;
    end if;

    if not exists (
      select 1 from public.daily_pick_products dpp
      join public.daily_picks dp on dp.id = dpp.daily_pick_id
      where dp.trading_day_id = p_trading_day_id
        and dpp.product_variety_id = v_variety_id
    ) then
      raise exception 'INVALID_INPUT: product variety % is not in today''s shop', v_variety_id using errcode = 'P0008';
    end if;

    insert into public.daily_order_products (daily_order_id, product_variety_id, pallets_ordered, comment)
    values (v_order.id, v_variety_id, v_pallets, v_comment)
    on conflict (daily_order_id, product_variety_id)
    do update set pallets_ordered = excluded.pallets_ordered, comment = excluded.comment, updated_at = now()
    returning id into v_line_id;

    v_kept_ids := v_kept_ids || v_line_id;
  end loop;

  -- Prune, but never destroy an allocation.
  --
  -- This used to be a bare DELETE of every line not present in p_lines,
  -- and arrangement_records.daily_order_product_id is ON DELETE CASCADE —
  -- so re-saving an order silently deleted the distributor's arrangement
  -- records for any line it dropped. That was already true for ordinary
  -- lines; it becomes a certainty with the zero-quantity lines
  -- arrange_to_customer creates, because submit_order skips zero-pallet
  -- lines entirely (see the `continue` above) and therefore never keeps
  -- one.
  --
  -- A line that something is arranged against is zeroed instead: the
  -- customer's request really is gone, which is what pallets_ordered = 0
  -- now means, but the pallets already committed to them stay visible on
  -- the arrangement board for the distributor to settle deliberately.
  update public.daily_order_products
  set pallets_ordered = 0, comment = null, updated_at = now()
  where daily_order_id = v_order.id
    and not (id = any (v_kept_ids))
    and exists (
      select 1 from public.arrangement_records ar
      where ar.daily_order_product_id = daily_order_products.id
    );

  delete from public.daily_order_products
  where daily_order_id = v_order.id
    and not (id = any (v_kept_ids))
    and not exists (
      select 1 from public.arrangement_records ar
      where ar.daily_order_product_id = daily_order_products.id
    );

  update public.daily_orders
  set status = 'submitted', submitted_at = now(), updated_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into public.order_submission_logs (daily_order_id, submitted_by, snapshot)
  values (v_order.id, (select auth.uid()), p_lines);

  -- id 6.
  if v_direct_customer_submission then
    select name into v_customer_company_name from public.companies where id = v_customer_company_id;
    perform public.enqueue_backoffice_notification(
      p_trading_day_id, 'order_submitted',
      jsonb_build_object('tradeDate', v_trade_date, 'lines', '[]'::jsonb, 'companyName', v_customer_company_name)
    );
  end if;

  -- ids 10/11.
  if v_touched_variety_ids is not null then
    foreach v_variety_id in array v_touched_variety_ids
    loop
      v_demand_before := coalesce((v_demand_before_snapshot ->> v_variety_id::text)::numeric, 0);

      select coalesce(sum(dop.pallets_ordered), 0) into v_demand_after
      from public.daily_order_products dop
      join public.daily_orders do2 on do2.id = dop.daily_order_id
      where do2.trading_day_id = p_trading_day_id
        and dop.product_variety_id = v_variety_id;

      select coalesce(sum(dpp.pallets_picked), 0) + coalesce(sum(dpp.leftover_pallets), 0) into v_supply
      from public.daily_pick_products dpp
      join public.daily_picks dp on dp.id = dpp.daily_pick_id
      where dp.trading_day_id = p_trading_day_id
        and dpp.product_variety_id = v_variety_id;

      select coalesce(no_overbooking, 0), name into v_overbooking, v_product_name
      from public.product_varieties where id = v_variety_id;

      if v_demand_before < v_supply and v_demand_after >= v_supply and v_demand_after < (v_supply + v_overbooking) then
        v_remaining := (v_supply + v_overbooking) - v_demand_after;
        perform public.enqueue_backoffice_notification(
          p_trading_day_id, 'stock_overbooking_reached',
          jsonb_build_object(
            'tradeDate', v_trade_date, 'lines', '[]'::jsonb,
            'productName', v_product_name,
            'productOverbooking', regexp_replace(v_remaining::text, '\.?0+$', '')
          )
        );
      elsif v_demand_before < (v_supply + v_overbooking) and v_demand_after >= (v_supply + v_overbooking) then
        perform public.enqueue_backoffice_notification(
          p_trading_day_id, 'stock_fully_exhausted',
          jsonb_build_object('tradeDate', v_trade_date, 'lines', '[]'::jsonb, 'productName', v_product_name)
        );
      end if;
    end loop;
  end if;

  return v_order;
end;
$$;

comment on function public.submit_order(uuid, jsonb, uuid) is
  'Customer-only for their own company (p_customer_company_id omitted). Backoffice-only when p_customer_company_id is supplied. One transaction: upserts-and-prunes daily_order_products from p_lines, sets the order to submitted and stamps submitted_at, writes one order_submission_logs row (attributed to whoever actually called this), and — only on a direct customer submission, never the backoffice-on-behalf-of path — enqueues one order_submitted notification to backoffice (id 6). Also computes, for every variety this call''s lines could have pushed across a threshold, whether it just became fully-ordered-with-overbooking-room (stock_overbooking_reached, id 10) or fully-exhausted (stock_fully_exhausted, id 11) — live, in this same transaction, never via a stored out-of-stock list or trigger. A pruned line that an arrangement_records row points at is zeroed rather than deleted, so re-saving an order can no longer cascade away the distributor''s allocations. Raises P0007 if the trading day is closed, P0008 if a line references a variety not in today''s shop or has a negative pallet count.';

grant execute on function public.submit_order(uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. arrange_to_customer
-- ---------------------------------------------------------------------------
-- "This customer gets N pallets off this grower's line." One idempotent
-- upsert behind the arrangement board's ✓ button, rather than the
-- create-or-update branch the client would otherwise have to pick between
-- — the client cannot know whether a record exists without a round trip,
-- and two clients pressing ✓ on the same row would race into a duplicate.
--
-- It also creates the customer's order line when there isn't one, at zero
-- pallets. That is the whole point of the lower half of the board's
-- customer list: the customer never ordered this variety, so there is
-- nothing to record as a request, only what the distributor has decided to
-- send them. `pallets_ordered` stays 0 and the arrangement carries the
-- quantity.
--
-- SECURITY: backoffice only, and security INVOKER — unlike submit_order,
-- which needs definer to let a customer write their own lines through a
-- table that has no customer write policy. Everything this function
-- touches (daily_order_products, arrangement_records) already has a
-- backoffice-only write policy of its own (0017, 0020), so running as the
-- caller means RLS is a second, independent check on the role test below
-- rather than something bypassed. The explicit test is still here so a
-- non-backoffice caller gets FORBIDDEN rather than a bare RLS violation,
-- matching every other function in this module.
create or replace function public.arrange_to_customer(
  p_daily_pick_product_id uuid,
  p_customer_company_id uuid,
  p_quantity_pallets numeric,
  p_price numeric default null,
  p_price_type text default null
)
returns public.arrangement_records
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_variety_id uuid;
  v_trading_day_id uuid;
  v_arrangement public.daily_arrangements;
  v_order public.daily_orders;
  v_order_line_id uuid;
  -- Read as separate scalars rather than into a row variable. A SELECT INTO
  -- that matches nothing leaves a row variable in a state whose field access
  -- is not worth relying on; a scalar is simply NULL, which is exactly the
  -- "there is no record yet" test the branch below makes.
  v_existing_id uuid;
  v_existing_price numeric;
  v_existing_price_type text;
  v_record public.arrangement_records;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select dpp.product_variety_id, dp.trading_day_id
    into v_variety_id, v_trading_day_id
  from public.daily_pick_products dpp
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  where dpp.id = p_daily_pick_product_id;
  if not found then
    raise exception 'NOT_FOUND: pick line % does not exist', p_daily_pick_product_id using errcode = 'P0002';
  end if;

  -- Locked before anything is written, so a close_arrangement running
  -- concurrently either finishes first (and this raises INVALID_STATE) or
  -- waits for this to commit. Without the lock a record could be inserted
  -- into an arrangement that is being closed and would miss pricing.
  select * into v_arrangement
  from public.daily_arrangements
  where trading_day_id = v_trading_day_id
  for update;
  if not found then
    raise exception 'NOT_FOUND: no arrangement exists for trading day %', v_trading_day_id using errcode = 'P0002';
  end if;
  if v_arrangement.status <> 'open' then
    raise exception 'INVALID_STATE: the arrangement is closed' using errcode = 'P0007';
  end if;

  -- The order HEADER must already exist — open_shop bootstraps one per
  -- active customer. Not creating one here is deliberate: a missing header
  -- means this customer wasn't trading today, and inventing one would
  -- quietly enrol them in the day.
  select * into v_order
  from public.daily_orders
  where trading_day_id = v_trading_day_id
    and customer_company_id = p_customer_company_id
  for update;
  if not found then
    raise exception 'NOT_FOUND: no daily order exists for company % on trading day %', p_customer_company_id, v_trading_day_id using errcode = 'P0002';
  end if;

  -- Find-or-create on the natural key, the same upsert shape as
  -- submit_order and bootstrap_grower_pick (R3). `do nothing` rather than
  -- `do update`: if the customer really did order this variety, their
  -- quantity is theirs and this function has no business touching it.
  insert into public.daily_order_products (daily_order_id, product_variety_id, pallets_ordered)
  values (v_order.id, v_variety_id, 0)
  on conflict (daily_order_id, product_variety_id) do nothing;

  select id into v_order_line_id
  from public.daily_order_products
  where daily_order_id = v_order.id
    and product_variety_id = v_variety_id
  for update;

  select id, price, price_type
    into v_existing_id, v_existing_price, v_existing_price_type
  from public.arrangement_records
  where daily_pick_product_id = p_daily_pick_product_id
    and daily_order_product_id = v_order_line_id
  for update;

  -- NULL on the way in when there is no record yet, which is what
  -- check_arrangement_allocation's p_excluding_record_id expects.
  perform public.check_arrangement_allocation(
    p_daily_pick_product_id, v_order_line_id, p_quantity_pallets, v_existing_id
  );

  if v_existing_id is not null then
    update public.arrangement_records
    set quantity_pallets = p_quantity_pallets,
        -- COALESCE, where update_arrangement_record assigns unconditionally.
        -- That function is the records table's full-row editor and clearing
        -- a price there is a real intent; this one is a quantity button, and
        -- omitting the price must not be a way to silently wipe the figure
        -- close_arrangement will notify the customer about.
        price = coalesce(p_price, v_existing_price),
        price_type = coalesce(p_price_type, v_existing_price_type),
        updated_at = now()
    where id = v_existing_id
    returning * into v_record;
  else
    insert into public.arrangement_records (
      daily_arrangement_id,
      daily_pick_product_id,
      daily_order_product_id,
      customer_company_id,
      quantity_pallets,
      price,
      price_type
    )
    values (
      v_arrangement.id,
      p_daily_pick_product_id,
      v_order_line_id,
      p_customer_company_id,
      p_quantity_pallets,
      p_price,
      p_price_type
    )
    returning * into v_record;
  end if;

  return v_record;
end;
$$;

comment on function public.arrange_to_customer(uuid, uuid, numeric, numeric, text) is
  'Backoffice-only. Sets this customer''s allocation off one grower pick line to p_quantity_pallets, creating the arrangement record if it does not exist and updating it if it does. Creates the customer''s daily_order_products line at pallets_ordered = 0 when they never ordered the variety — the arrangement board''s "push surplus to a customer who did not order" action. Price and price_type are COALESCEd onto the existing record rather than assigned, so a quantity-only press cannot blank a price. Raises P0002 if the pick line, the day''s arrangement or the customer''s order header is missing, P0007 if the arrangement is closed, P0008 for a non-positive quantity, and P0009 if the quantity would exceed the pick line''s pallets_picked.';

grant execute on function public.arrange_to_customer(uuid, uuid, numeric, numeric, text) to authenticated;
