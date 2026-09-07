-- Product photos for the customer order screens (matches the reference
-- design's round thumbnail on each collapsed product-family row — the
-- shop's order screen groups by family, expanding to the family's
-- varieties, so the photo belongs on product_families, not
-- product_varieties). No values are backfilled here — every existing row
-- gets image_url = null, so the client falls back to a generic icon
-- client-side until real photos are uploaded per family.
-- `if not exists`: this migration was attempted once already and failed
-- partway through (the function replace below, not this column, since
-- Postgres doesn't allow `create or replace function` to add a column to
-- a `returns table (...)` shape — see the `drop function` note below) — a
-- retry must not error out re-adding a column that may already be there.
alter table "public"."product_families" add column if not exists "image_url" text;

comment on column "public"."product_families"."image_url" is
  'Optional public URL of a product photo, shown as a round thumbnail on the customer order screen''s collapsed family row. Null falls back to a generic icon client-side.';

-- get_orderable_catalog_for_customer (0018_customer-order-functions.sql,
-- extended in 0028_customer-order-status-screen.sql with the optional
-- p_customer_company_id backoffice parameter): image_url appended as the
-- last output column (one family's image_url is duplicated across every
-- one of its variety rows — the client groups by family and only reads it
-- once per group), plpgsql body otherwise byte-for-byte identical to
-- 0028's version.
--
-- `create or replace function` cannot change a `returns table (...)`
-- shape (Postgres error 42P13: "cannot change return type of existing
-- function... Row type defined by OUT parameters is different") — adding
-- a column counts as changing it, same as removing or reordering one
-- would. An explicit drop is required first; `if exists` makes this safe
-- to re-run after a failed attempt.
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
  image_url text
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
    pf.image_url
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
  'Any authenticated user for their own company (p_customer_company_id omitted). Backoffice-only when p_customer_company_id is supplied — raises FORBIDDEN for any other caller, not just RLS-filtered. The single source of truth for which varieties a customer may currently order, shared by the customer''s own order screen and the backoffice Customer Order Status screen (apps/web/src/routes/backoffice/distributor-customer.tsx). image_url is the variety''s family''s photo (same value repeated across every variety row in that family), unrelated to price visibility.';

grant execute on function public.get_orderable_catalog_for_customer(uuid, uuid) to authenticated;
