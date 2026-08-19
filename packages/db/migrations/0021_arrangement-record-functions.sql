-- The distributor's matchmaking write surface (the "New Arrangement
-- Wizard" backend): create / update / delete an arrangement record
-- pairing one grower pick line with one customer order line. All three
-- are security invoker (backoffice-only), matching every other
-- backoffice-only lifecycle function — there's no ownership rule here an
-- RLS predicate can't already express (arrangement_records' own RLS is
-- already backoffice-write-only), so no bypass is needed the way the
-- grower/customer modules' security definer functions need one.

-- Shared over-allocation guard, factored out so create/update apply the
-- identical rule rather than two copies that could drift (R1/R6): a
-- quantity can never make a pick line's total-arranged exceed what was
-- picked, or an order line's total-arranged exceed what was ordered.
-- p_excluding_record_id lets update_arrangement_record exclude the
-- record's own prior quantity from the "already arranged" sum, so
-- reducing (or leaving unchanged) a quantity never self-blocks.
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

  select coalesce(sum(quantity_pallets), 0) into v_demand_arranged
  from public.arrangement_records
  where daily_order_product_id = p_daily_order_product_id
    and (p_excluding_record_id is null or id <> p_excluding_record_id);

  if v_demand_arranged + p_quantity_pallets > v_pallets_ordered then
    raise exception 'OVER_ALLOCATION: % pallets already arranged + % requested exceeds % pallets ordered on this line',
      v_demand_arranged, p_quantity_pallets, v_pallets_ordered
      using errcode = 'P0009';
  end if;
end;
$$;

comment on function public.check_arrangement_allocation(uuid, uuid, numeric, uuid) is
  'Internal. Raises P0009 if arranging p_quantity_pallets against either line would exceed that line''s own pallets_picked/pallets_ordered ceiling, summed against every OTHER arrangement_records row referencing it. Shared by create_arrangement_record and update_arrangement_record so the rule can''t drift between them.';

-- create_arrangement_record
create or replace function public.create_arrangement_record(
  p_daily_pick_product_id uuid,
  p_daily_order_product_id uuid,
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
  v_pick_variety uuid;
  v_pick_trading_day uuid;
  v_order_variety uuid;
  v_order_trading_day uuid;
  v_customer_company_id uuid;
  v_arrangement public.daily_arrangements;
  v_record public.arrangement_records;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select dpp.product_variety_id, dp.trading_day_id
    into v_pick_variety, v_pick_trading_day
  from public.daily_pick_products dpp
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  where dpp.id = p_daily_pick_product_id;
  if not found then
    raise exception 'NOT_FOUND: pick line % does not exist', p_daily_pick_product_id using errcode = 'P0002';
  end if;

  select dop.product_variety_id, do2.trading_day_id, do2.customer_company_id
    into v_order_variety, v_order_trading_day, v_customer_company_id
  from public.daily_order_products dop
  join public.daily_orders do2 on do2.id = dop.daily_order_id
  where dop.id = p_daily_order_product_id;
  if not found then
    raise exception 'NOT_FOUND: order line % does not exist', p_daily_order_product_id using errcode = 'P0002';
  end if;

  if v_pick_trading_day <> v_order_trading_day then
    raise exception 'INVALID_INPUT: pick line and order line belong to different trading days' using errcode = 'P0008';
  end if;
  if v_pick_variety <> v_order_variety then
    raise exception 'INVALID_INPUT: pick line and order line are different product varieties' using errcode = 'P0008';
  end if;

  select * into v_arrangement from public.daily_arrangements where trading_day_id = v_pick_trading_day for update;
  if not found then
    raise exception 'NOT_FOUND: no daily arrangement exists for this trading day' using errcode = 'P0002';
  end if;
  if v_arrangement.status <> 'open' then
    raise exception 'INVALID_STATE: the arrangement is closed' using errcode = 'P0007';
  end if;

  perform public.check_arrangement_allocation(p_daily_pick_product_id, p_daily_order_product_id, p_quantity_pallets, null);

  insert into public.arrangement_records (
    daily_arrangement_id, daily_pick_product_id, daily_order_product_id,
    customer_company_id, quantity_pallets, price, price_type
  )
  values (
    v_arrangement.id, p_daily_pick_product_id, p_daily_order_product_id,
    v_customer_company_id, p_quantity_pallets, p_price, p_price_type
  )
  returning * into v_record;

  return v_record;
end;
$$;

comment on function public.create_arrangement_record(uuid, uuid, numeric, numeric, text) is
  'Backoffice-only. Pairs a specific grower pick line with a specific customer order line for p_quantity_pallets. Both lines must belong to the same trading day and the same product variety. Raises P0009 if the quantity would over-allocate either line''s supply or demand ceiling (check_arrangement_allocation), P0007 if the day''s arrangement is already closed.';

grant execute on function public.create_arrangement_record(uuid, uuid, numeric, numeric, text) to authenticated;

-- update_arrangement_record
create or replace function public.update_arrangement_record(
  p_id uuid,
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
  v_existing public.arrangement_records;
  v_arrangement public.daily_arrangements;
  v_record public.arrangement_records;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_existing from public.arrangement_records where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND: arrangement record % does not exist', p_id using errcode = 'P0002';
  end if;

  select * into v_arrangement from public.daily_arrangements where id = v_existing.daily_arrangement_id for update;
  if v_arrangement.status <> 'open' then
    raise exception 'INVALID_STATE: the arrangement is closed' using errcode = 'P0007';
  end if;

  perform public.check_arrangement_allocation(
    v_existing.daily_pick_product_id, v_existing.daily_order_product_id, p_quantity_pallets, p_id
  );

  update public.arrangement_records
  set quantity_pallets = p_quantity_pallets,
      price = p_price,
      price_type = p_price_type,
      updated_at = now()
  where id = p_id
  returning * into v_record;

  return v_record;
end;
$$;

comment on function public.update_arrangement_record(uuid, numeric, numeric, text) is
  'Backoffice-only. Changes an existing arrangement record''s quantity/price/price_type. Same over-allocation guard as create_arrangement_record, excluding this record''s own prior quantity from the ceiling check. Raises P0007 if the arrangement is already closed.';

grant execute on function public.update_arrangement_record(uuid, numeric, numeric, text) to authenticated;

-- delete_arrangement_record
create or replace function public.delete_arrangement_record(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing public.arrangement_records;
  v_arrangement public.daily_arrangements;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_existing from public.arrangement_records where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND: arrangement record % does not exist', p_id using errcode = 'P0002';
  end if;

  select * into v_arrangement from public.daily_arrangements where id = v_existing.daily_arrangement_id for update;
  if v_arrangement.status <> 'open' then
    raise exception 'INVALID_STATE: the arrangement is closed' using errcode = 'P0007';
  end if;

  delete from public.arrangement_records where id = p_id;
end;
$$;

comment on function public.delete_arrangement_record(uuid) is
  'Backoffice-only. Removes an arrangement record, freeing up its pick/order lines'' allocation. Raises P0007 if the arrangement is already closed.';

grant execute on function public.delete_arrangement_record(uuid) to authenticated;
