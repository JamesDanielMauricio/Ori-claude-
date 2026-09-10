-- Customer order screen: a per-variety ceiling on how many pallets any ONE
-- customer may put on a single order line, dynamically clamped to whatever
-- stock is actually still available. Requested as "number_of_orders_per_
-- customer" — not in the source PRD's Product Variety field list, same
-- status as product_customer_caps (0007_reference-data-functions.sql) —
-- and deliberately a different thing from that table: this is one default
-- that applies to every customer, product_customer_caps overrides one
-- specific customer. The two are independent; this migration does not
-- touch product_customer_caps.
alter table "public"."product_varieties"
  add column if not exists "number_of_orders_per_customer" integer;

comment on column "public"."product_varieties"."number_of_orders_per_customer" is
  'Max pallets of this variety any one customer may request on a single order line. Null = no variety-level cap (bounded by remaining stock only). Read by max_orderable_for_customer(); enforced client-side (the customer order screen''s quantity control becomes a dropdown capped at this number) and server-side (submit_order, direct customer submissions only).';

-- save_product, with the new column added as an extra parameter. Adding a
-- parameter changes the function's argument-type signature, which
-- `create or replace function` treats as a NEW overload rather than a
-- replacement (unlike the `returns table` case, this is true for ANY
-- signature change, not just a `drop`-then-`create` return-shape change) —
-- left alone, PostgREST would end up with two save_product candidates and
-- refuse to pick one. The explicit drop avoids that. Body otherwise
-- byte-for-byte identical to 0008's version.
drop function if exists public.save_product(
  uuid, uuid, text, text, public.pack_type, numeric, numeric, numeric, text, numeric,
  boolean, boolean, integer, jsonb
);

create function public.save_product(
  p_id uuid,
  p_family_id uuid,
  p_name text,
  p_sizes text,
  p_pack_type public.pack_type,
  p_price numeric,
  p_price_range_from numeric,
  p_price_range_to numeric,
  p_price_type text,
  p_no_overbooking numeric,
  p_highlight_price_fluctuations boolean,
  p_is_seasonal_available boolean,
  p_number_of_orders_per_customer integer,
  p_expected_version integer,
  p_customer_pallet_caps jsonb
)
returns public.product_varieties
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_product public.product_varieties;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.product_varieties (
      family_id, name, sizes, pack_type, price, price_range_from, price_range_to,
      price_type, no_overbooking, highlight_price_fluctuations, is_seasonal_available,
      number_of_orders_per_customer, version
    )
    values (
      p_family_id, p_name, p_sizes, p_pack_type, p_price, p_price_range_from, p_price_range_to,
      p_price_type, p_no_overbooking, p_highlight_price_fluctuations, p_is_seasonal_available,
      p_number_of_orders_per_customer, 1
    )
    returning * into v_product;
  else
    update public.product_varieties
    set family_id = p_family_id,
        name = p_name,
        sizes = p_sizes,
        pack_type = p_pack_type,
        price = p_price,
        price_range_from = p_price_range_from,
        price_range_to = p_price_range_to,
        price_type = p_price_type,
        no_overbooking = p_no_overbooking,
        highlight_price_fluctuations = p_highlight_price_fluctuations,
        is_seasonal_available = p_is_seasonal_available,
        number_of_orders_per_customer = p_number_of_orders_per_customer,
        version = version + 1,
        updated_at = now()
    where id = p_id and version = p_expected_version
    returning * into v_product;

    if not found then
      if exists (select 1 from public.product_varieties where id = p_id) then
        raise exception
          'CONFLICT: product % was modified by someone else since it was loaded (expected version %)',
          p_id, p_expected_version
          using errcode = 'P0003';
      else
        raise exception 'NOT_FOUND: product % does not exist', p_id using errcode = 'P0002';
      end if;
    end if;
  end if;

  with incoming as (
    select (elem ->> 'customerCompanyId')::uuid as customer_company_id,
           (elem ->> 'palletCap')::integer as pallet_cap
    from jsonb_array_elements(p_customer_pallet_caps) as elem
  )
  delete from public.product_customer_caps pcc
  where pcc.product_variety_id = v_product.id
    and not exists (
      select 1 from incoming i where i.customer_company_id = pcc.customer_company_id
    );

  insert into public.product_customer_caps (product_variety_id, customer_company_id, pallet_cap)
  select v_product.id, (elem ->> 'customerCompanyId')::uuid, (elem ->> 'palletCap')::integer
  from jsonb_array_elements(p_customer_pallet_caps) as elem
  on conflict (product_variety_id, customer_company_id)
    do update set pallet_cap = excluded.pallet_cap, updated_at = now();

  return v_product;
end;
$$;

comment on function public.save_product(
  uuid, uuid, text, text, public.pack_type, numeric, numeric, numeric, text, numeric,
  boolean, boolean, integer, integer, jsonb
) is
  'Backoffice-only. Upserts a product variety with optimistic concurrency (p_expected_version must match the current row; raises P0003 on conflict) and replaces its per-customer pallet caps wholesale. Pass p_id = null to create (version starts at 1, p_expected_version ignored). p_number_of_orders_per_customer is the variety-level default order cap (migration 0042; null = uncapped) — independent of p_customer_pallet_caps, which overrides one specific customer. p_customer_pallet_caps is a jsonb array of {"customerCompanyId": uuid, "palletCap": integer}.';

grant execute on function public.save_product(
  uuid, uuid, text, text, public.pack_type, numeric, numeric, numeric, text, numeric,
  boolean, boolean, integer, integer, jsonb
) to authenticated;

-- max_orderable_for_customer — the one place "how much can THIS customer
-- still order of THIS variety" is computed, called from both
-- get_orderable_catalog_for_customer (to size the customer's quantity
-- dropdown) and submit_order (to enforce the same number server-side).
-- Same rationale as shop_variety_orderability just above it in
-- 0018_customer-order-functions.sql: one named function instead of two
-- places that are each supposed to independently agree on the arithmetic.
--
-- security definer: computing "demand from every OTHER customer" requires
-- reading across tenants, same cross-tenant need shop_variety_orderability
-- already has. Returns a single clamped number — never a raw order or pick
-- row — so, like that function, this is safe to run with elevated
-- privileges without leaking any other customer's individual order.
--
-- The "other customers'" exclusion (not just "this order's own line") is
-- what lets a customer raise their own existing line back up to the full
-- remaining pool instead of being blocked by pallets they themselves
-- already hold.
create or replace function public.max_orderable_for_customer(
  p_trading_day_id uuid,
  p_product_variety_id uuid,
  p_customer_company_id uuid
)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select greatest(
    least(
      pv.number_of_orders_per_customer::numeric,
      (coalesce(supply.total, 0) + coalesce(pv.no_overbooking, 0)) - coalesce(demand_others.total, 0)
    ),
    0
  )
  from public.product_varieties pv
  left join lateral (
    select sum(dpp.pallets_picked) + sum(coalesce(dpp.leftover_pallets, 0)) as total
    from public.daily_pick_products dpp
    join public.daily_picks dp on dp.id = dpp.daily_pick_id
    where dp.trading_day_id = p_trading_day_id
      and dpp.product_variety_id = p_product_variety_id
  ) supply on true
  left join lateral (
    select sum(dop.pallets_ordered) as total
    from public.daily_order_products dop
    join public.daily_orders do2 on do2.id = dop.daily_order_id
    where do2.trading_day_id = p_trading_day_id
      and dop.product_variety_id = p_product_variety_id
      and do2.customer_company_id <> p_customer_company_id
  ) demand_others on true
  where pv.id = p_product_variety_id;
$$;

comment on function public.max_orderable_for_customer(uuid, uuid, uuid) is
  'Internal. The most pallets p_customer_company_id may have on their own order line for p_product_variety_id on p_trading_day_id: least(the variety''s number_of_orders_per_customer, remaining stock = (picked + leftovers + no_overbooking) - demand from every OTHER customer), floored at 0. A null number_of_orders_per_customer is ignored by least() (no variety-level cap), leaving stock as the only ceiling. security definer cross-tenant aggregate, like shop_variety_orderability — returns one number, never a raw row.';

grant execute on function public.max_orderable_for_customer(uuid, uuid, uuid) to authenticated;

-- get_orderable_catalog_for_customer, extended with max_orderable_for_customer
-- as the last output column (one more numeric per row, computed via the
-- function above). `create or replace function` cannot change a `returns
-- table (...)` shape, so — same as 0036's image_url addition — an explicit
-- drop is required first; `if exists` makes this safe to re-run after a
-- failed attempt. Body otherwise byte-for-byte identical to 0036's version.
drop function if exists public.get_orderable_catalog_for_customer(uuid, uuid);

create function public.get_orderable_catalog_for_customer(
  p_trading_day_id uuid,
  p_customer_company_id uuid default null
)
returns table (
  family_id uuid,
  family_name text,
  variety_id uuid,
  variety_name text,
  pack_type public.pack_type,
  price numeric,
  price_range_from numeric,
  price_range_to numeric,
  price_type text,
  is_orderable boolean,
  pallets_ordered numeric,
  comment text,
  image_url text,
  max_orderable_for_customer numeric
)
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  v_target_company_id uuid;
begin
  if p_customer_company_id is not null then
    if public.current_role() <> 'backoffice' then
      raise exception 'FORBIDDEN: only backoffice may query another company''s catalog' using errcode = '42501';
    end if;
    v_target_company_id := p_customer_company_id;
  else
    v_target_company_id := public.current_company_id();
  end if;

  return query
  select
    pf.id as family_id,
    pf.name as family_name,
    pv.id as variety_id,
    pv.name as variety_name,
    pv.pack_type,
    case when ds.can_see_prices then pv.price else null end as price,
    case when ds.can_see_prices then pv.price_range_from else null end as price_range_from,
    case when ds.can_see_prices then pv.price_range_to else null end as price_range_to,
    case when ds.can_see_prices then pv.price_type else null end as price_type,
    sv.is_orderable,
    coalesce(dop.pallets_ordered, 0) as pallets_ordered,
    dop.comment,
    pf.image_url,
    public.max_orderable_for_customer(p_trading_day_id, pv.id, v_target_company_id) as max_orderable_for_customer
  from public.shop_variety_orderability(p_trading_day_id) sv
  join public.product_varieties pv on pv.id = sv.product_variety_id
  join public.product_families pf on pf.id = pv.family_id
  join public.daily_shops ds on ds.trading_day_id = p_trading_day_id
  left join public.daily_orders ord
    on ord.trading_day_id = p_trading_day_id
    and ord.customer_company_id = v_target_company_id
  left join public.daily_order_products dop
    on dop.daily_order_id = ord.id
    and dop.product_variety_id = pv.id
  where sv.is_orderable or dop.id is not null
  order by pf.name, pv.name;
end;
$$;

comment on function public.get_orderable_catalog_for_customer(uuid, uuid) is
  'Any authenticated user for their own company (p_customer_company_id omitted). Backoffice-only when p_customer_company_id is supplied — raises FORBIDDEN for any other caller, not just RLS-filtered. The single source of truth for which varieties a customer may currently order, shared by the customer''s own order screen and the backoffice Customer Order Status screen (apps/web/src/routes/backoffice/distributor-customer.tsx). image_url is the variety''s family''s photo (same value repeated across every variety row in that family), unrelated to price visibility. max_orderable_for_customer is v_target_company_id''s own ceiling for that row (see max_orderable_for_customer()) — always populated, including on the backoffice on-behalf-of path, but only the customer''s own order screen''s UI treats it as a hard limit; the backoffice edit path lets staff override it.';

grant execute on function public.get_orderable_catalog_for_customer(uuid, uuid) to authenticated;

-- submit_order: one added check per line, direct-customer-submission only
-- (never the backoffice on-behalf-of path — v_direct_customer_submission
-- already distinguishes the two for the existing id-6 notification below).
-- Reproduced in full because `create or replace function` has no way to
-- patch one statement; byte-for-byte identical to 0040's version apart from
-- the new "if v_direct_customer_submission" block inside the per-line loop.
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
  v_max_orderable numeric;
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

    -- The dropdown's own ceiling, re-checked server-side so a direct API
    -- call can't exceed what the UI offered — never applied to the
    -- backoffice on-behalf-of path, where staff may deliberately override
    -- it (see max_orderable_for_customer's comment).
    if v_direct_customer_submission then
      v_max_orderable := public.max_orderable_for_customer(p_trading_day_id, v_variety_id, v_customer_company_id);
      if v_pallets > v_max_orderable then
        raise exception 'INVALID_INPUT: % pallets requested exceeds the % pallet limit available for this product', v_pallets, v_max_orderable
          using errcode = 'P0008';
      end if;
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
  'Customer-only for their own company (p_customer_company_id omitted). Backoffice-only when p_customer_company_id is supplied. One transaction: upserts-and-prunes daily_order_products from p_lines, sets the order to submitted and stamps submitted_at, writes one order_submission_logs row (attributed to whoever actually called this), and — only on a direct customer submission, never the backoffice-on-behalf-of path — enqueues one order_submitted notification to backoffice (id 6) and rejects (P0008) any line exceeding max_orderable_for_customer() for that variety. Also computes, for every variety this call''s lines could have pushed across a threshold, whether it just became fully-ordered-with-overbooking-room (stock_overbooking_reached, id 10) or fully-exhausted (stock_fully_exhausted, id 11) — live, in this same transaction, never via a stored out-of-stock list or trigger. A pruned line that an arrangement_records row points at is zeroed rather than deleted, so re-saving an order can no longer cascade away the distributor''s allocations. Raises P0007 if the trading day is closed, P0008 if a line references a variety not in today''s shop, has a negative pallet count, or (direct customer submissions only) exceeds the per-customer cap.';

grant execute on function public.submit_order(uuid, jsonb, uuid) to authenticated;
