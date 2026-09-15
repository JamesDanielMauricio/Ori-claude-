-- get_orderable_catalog_for_customer, extended with the variety's `sizes`
-- free-text column (product_varieties.sizes) so the customer order screen
-- can show a variety's size beside its name (e.g. "Apple 5" vs "Apple 7") —
-- the same catalog fields, just never previously carried through this RPC.
-- `create or replace function` cannot change a `returns table (...)` shape,
-- so — same as 0036's image_url addition and 0042's max_orderable_for_
-- customer addition — an explicit drop is required first; `if exists` makes
-- this safe to re-run after a failed attempt. Body otherwise byte-for-byte
-- identical to 0042's version.
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
  sizes text,
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
    pv.sizes,
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
  'Any authenticated user for their own company (p_customer_company_id omitted). Backoffice-only when p_customer_company_id is supplied — raises FORBIDDEN for any other caller, not just RLS-filtered. The single source of truth for which varieties a customer may currently order, shared by the customer''s own order screen and the backoffice Customer Order Status screen (apps/web/src/routes/backoffice/distributor-customer.tsx). sizes is the variety''s free-text size descriptor (product_varieties.sizes), meant to be shown beside variety_name. image_url is the variety''s family''s photo (same value repeated across every variety row in that family), unrelated to price visibility. max_orderable_for_customer is v_target_company_id''s own ceiling for that row (see max_orderable_for_customer()) — always populated, including on the backoffice on-behalf-of path, but only the customer''s own order screen''s UI treats it as a hard limit; the backoffice edit path lets staff override it.';

grant execute on function public.get_orderable_catalog_for_customer(uuid, uuid) to authenticated;
