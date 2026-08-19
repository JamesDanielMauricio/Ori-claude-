-- Customer ordering: the shared orderable-catalog function (R1/R5/R6) and
-- the transactional order-submission function (R3/R4) that replace the
-- source's async out-of-stock trigger pair and dash-packed
-- save_order_line workflow.
--
-- R6 — the rule being preserved: out-of-stock visibility is computed at
-- the VARIETY level; a family is shown iff at least one of its varieties
-- is still orderable. The source got this right at the variety level
-- (`RepeatingGroup Daily Pick Product`) but then re-applied a SEPARATE,
-- over-aggressive family-level filter on top of it
-- (`RepeatingGroup Product Family main 1`'s `_id not in OOS.families`
-- constraint) that hid an entire family the moment ANY one variety in it
-- went out of stock — even when a sibling variety in the same family was
-- still in stock. That second filter is not reproduced here. There is
-- exactly one filter, computed at variety level
-- (`shop_variety_orderability` below); grouping into families is a pure
-- client-side/query-side projection of whichever variety rows survive it,
-- so an empty family structurally cannot render (R6's "empty-family edge
-- case" — a family only appears if at least one variety contributed a
-- row).
--
-- R5 — no trigger. The source's OOS-list trigger only fired
-- `OldDataItem._id is_not_empty` on order lines — true on UPDATE, false
-- on CREATE — so the first customer to deplete a variety never flipped
-- the shop's stored list; everyone else kept seeing it as in stock. There
-- is no stored out-of-stock list here to go stale in the first place:
-- orderability is computed live, on every read, by
-- `get_orderable_catalog_for_customer` below. A function with no
-- CREATE/UPDATE distinction to get wrong replaces a trigger that had one.
--
-- Both bugs shared one root cause worth naming: propagated/duplicated
-- filtering logic drifts. The fix in both cases is the same shape — one
-- named function, called from everywhere that needs the answer, instead
-- of two things that are each supposed to independently agree.

-- 1. shop_variety_orderability — the only part of this module that reads
--    across tenants (every grower's picks, every customer's orders) to
--    compute real supply-vs-demand. security definer specifically to
--    allow that cross-tenant aggregate; returns ONLY a variety id and a
--    boolean, never a raw pick or order row, so no cross-tenant row data
--    ever leaves this function's boundary. Not meant to be called
--    directly by client code (though it's harmless if it is, since it
--    exposes nothing sensitive) — get_orderable_catalog_for_customer
--    below is the actual client-facing surface.
create or replace function public.shop_variety_orderability(p_trading_day_id uuid)
returns table (product_variety_id uuid, is_orderable boolean)
language sql
security definer
set search_path = public
stable
as $$
  select
    v.product_variety_id,
    (coalesce(supply.total, 0) + coalesce(pv.no_overbooking, 0)) > coalesce(demand.total, 0) as is_orderable
  from (
    select distinct dpp.product_variety_id
    from public.daily_pick_products dpp
    join public.daily_picks dp on dp.id = dpp.daily_pick_id
    where dp.trading_day_id = p_trading_day_id
  ) v
  join public.product_varieties pv on pv.id = v.product_variety_id
  left join lateral (
    select sum(dpp.pallets_picked) + sum(coalesce(dpp.leftover_pallets, 0)) as total
    from public.daily_pick_products dpp
    join public.daily_picks dp on dp.id = dpp.daily_pick_id
    where dp.trading_day_id = p_trading_day_id
      and dpp.product_variety_id = v.product_variety_id
  ) supply on true
  left join lateral (
    select sum(dop.pallets_ordered) as total
    from public.daily_order_products dop
    join public.daily_orders do2 on do2.id = dop.daily_order_id
    where do2.trading_day_id = p_trading_day_id
      and dop.product_variety_id = v.product_variety_id
  ) demand on true;
$$;

comment on function public.shop_variety_orderability(uuid) is
  'Internal. security definer cross-tenant aggregate: for every variety with at least one grower pick line on this trading day, whether total_supply (picked + leftovers + no_overbooking) exceeds total_demand (ordered), across ALL growers/customers. Returns only (variety_id, boolean) — never a raw row — so this is safe to run with elevated privileges without leaking any individual grower''s or customer''s data.';

grant execute on function public.shop_variety_orderability(uuid) to authenticated;

-- 2. get_orderable_catalog_for_customer — the single shared function both
--    the main browse view and the submission-confirmation view call.
--    security invoker: runs under the caller's own session, so its reads
--    of product_varieties/product_families/daily_shops (broadly
--    readable) and daily_orders/daily_order_products (the caller's OWN
--    rows, via the existing "select own" RLS policies) are exactly what
--    RLS already allows that caller to see — no bypass. The one place
--    this needs data an ordinary customer session can't read directly
--    (cross-tenant supply/demand) is delegated to
--    shop_variety_orderability above, which returns nothing more
--    sensitive than a boolean.
--
-- Uses current_company_id(), not a parameter, for "this customer's own
-- cart" — there is no way to pass another company's id and read their
-- order lines through this function; RLS on daily_order_products would
-- filter them out even if the parameter were trusted, but not accepting
-- it as a parameter at all removes the spoofing surface entirely.
create or replace function public.get_orderable_catalog_for_customer(p_trading_day_id uuid)
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
  comment text
)
language sql
security invoker
set search_path = public
stable
as $$
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
    dop.comment
  from public.shop_variety_orderability(p_trading_day_id) sv
  join public.product_varieties pv on pv.id = sv.product_variety_id
  join public.product_families pf on pf.id = pv.family_id
  join public.daily_shops ds on ds.trading_day_id = p_trading_day_id
  left join public.daily_orders ord
    on ord.trading_day_id = p_trading_day_id
    and ord.customer_company_id = public.current_company_id()
  left join public.daily_order_products dop
    on dop.daily_order_id = ord.id
    and dop.product_variety_id = pv.id
  -- The rule, applied exactly once: a variety row survives if it's
  -- currently orderable, OR it's already in this customer's own cart
  -- (the per-customer carve-out — a variety that went OOS after they
  -- added it stays visible to them, per v1.3). Grouping these surviving
  -- variety rows by family (client-side, or via a second query's GROUP
  -- BY) is what makes a family "survive" — never a second, independent
  -- family-level filter.
  where sv.is_orderable or dop.id is not null
  order by pf.name, pv.name;
$$;

comment on function public.get_orderable_catalog_for_customer(uuid) is
  'Any authenticated user. The single source of truth for which varieties a customer may currently order, grouped by family purely by the caller''s query/UI (never a second family-level filter). A variety row is included if it is orderable (supply > demand) OR already in the calling customer''s own order for this trading day (the per-customer carve-out). price/price_range/price_type are null when the day''s shop has can_see_prices = false. Both the main order screen and the submission-confirmation view call this exact function — see apps/web/src/app/(customer)/customer/order/.';

grant execute on function public.get_orderable_catalog_for_customer(uuid) to authenticated;

-- 3. submit_order — one transaction (R4): upserts-and-prunes the
--    customer's order lines from the submitted set (same shape as
--    bootstrap_grower_pick, R3 — a real database upsert, never a
--    dash-packed text parameter the way save_order_line parsed one), sets
--    the order to submitted, and writes one order_submission_logs row —
--    all-or-nothing. Replaces the source's 5-action save_order_line
--    workflow entirely (itself only ever called per keystroke-batch, with
--    the documented unescaped-dash comment-corruption fragility); R1
--    keeps the behavior ("customer can set a pallet count + comment per
--    variety, zero removes the line") and discards the parsing mechanism
--    that behavior happened to be implemented with.
--
-- p_lines shape: [{ "productVarietyId": uuid, "palletsOrdered": number,
-- "comment": string | null }, ...] — only lines with palletsOrdered > 0
-- need to be included; anything not present is treated as removed.
create or replace function public.submit_order(
  p_trading_day_id uuid,
  p_lines jsonb
)
returns public.daily_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.daily_orders;
  v_phase public.trading_day_phase;
  v_line jsonb;
  v_kept_ids uuid[] := '{}';
  v_line_id uuid;
  v_pallets numeric;
  v_comment text;
  v_variety_id uuid;
begin
  if public.current_role() <> 'customer' then
    raise exception 'FORBIDDEN: customer role required' using errcode = '42501';
  end if;

  select phase into v_phase from public.trading_days where id = p_trading_day_id;
  if not found then
    raise exception 'NOT_FOUND: trading day % does not exist', p_trading_day_id using errcode = 'P0002';
  end if;
  if v_phase = 'closed' then
    raise exception 'INVALID_STATE: cannot submit an order once the trading day is closed' using errcode = 'P0007';
  end if;

  select * into v_order
  from public.daily_orders
  where trading_day_id = p_trading_day_id
    and customer_company_id = public.current_company_id()
  for update;

  if not found then
    raise exception 'NOT_FOUND: no daily order exists for your company on this trading day' using errcode = 'P0002';
  end if;

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

  -- Prune: any existing line not present (at a positive quantity) in this
  -- submission is removed — the hard-delete-at-zero rule, applied to the
  -- whole submitted set at once rather than one dash-packed call per line.
  delete from public.daily_order_products
  where daily_order_id = v_order.id
    and not (id = any (v_kept_ids));

  update public.daily_orders
  set status = 'submitted', submitted_at = now(), updated_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into public.order_submission_logs (daily_order_id, submitted_by, snapshot)
  values (v_order.id, (select auth.uid()), p_lines);

  return v_order;
end;
$$;

comment on function public.submit_order(uuid, jsonb) is
  'Customer-only (their own company''s order — derived from current_company_id(), never a passed-in target). One transaction: upserts-and-prunes daily_order_products from p_lines (a line with palletsOrdered <= 0 is simply not kept — hard delete, never a soft-delete flag), sets the order to submitted and stamps submitted_at (on every call, not just the first — edits after submission are allowed and re-submit), and writes one order_submission_logs row. Raises P0007 if the trading day is closed, P0008 if a line references a variety not in today''s shop or has a negative pallet count.';

grant execute on function public.submit_order(uuid, jsonb) to authenticated;
