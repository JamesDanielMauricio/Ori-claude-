-- Customers could read every product's price straight from the API,
-- whatever the day's can_see_prices setting said.
--
-- The rule "customers see prices only when the shop is opened with
-- can_see_prices" was enforced in exactly one place —
-- get_orderable_catalog_for_customer, which blanks the four price columns
-- when daily_shops.can_see_prices is off. But product_varieties itself was
-- readable in full by every signed-in account ("..._select_authenticated",
-- `using (true)`, 0003), so one direct read —
--
--   GET /rest/v1/product_varieties?select=name,price
--
-- — returned every price to any customer, and to any account a stranger
-- registers for themselves while public sign-up is on.
--
-- Hiding only the price COLUMNS isn't possible here: backoffice users are
-- the same `authenticated` Postgres role as customers, and the day's own
-- pricing (populate_arrangement_prices inside close_arrangement), save_product
-- and the Products screen all read those columns as that role. So instead
-- customers stop reading product_varieties directly at all, and the two
-- places a customer legitimately needs variety data read it through
-- functions that decide what a customer may see:
--   1. the order catalog — get_orderable_catalog_for_customer, below;
--   2. a closed order's lines — get_customer_order_lines, below (the one
--      direct embed a customer screen made: routes/customer/order.tsx's
--      ClosedOrderView).
-- Growers keep reading the table directly: their pick editor embeds the
-- variety's name, and the can_see_prices rule is about customers.

-- ---------------------------------------------------------------------------
-- 1. product_varieties: readable by backoffice and growers only
-- ---------------------------------------------------------------------------
--
-- SECURITY: ALLOWS backoffice (the whole catalog screen, pricing, the
-- arrangement boards) and growers (their pick lines' variety names) to read
-- product_varieties rows. PROTECTS AGAINST a customer — or a self-registered
-- account with no profile, for which current_role() is NULL and the check is
-- false — reading any variety row directly, and with it the price columns the
-- catalog function hides from them. No other policy reads product_varieties,
-- so removing a customer's row access changes nothing else they can see.
drop policy if exists "product_varieties_select_authenticated" on public.product_varieties;
drop policy if exists "product_varieties_select_backoffice_and_growers" on public.product_varieties;

create policy "product_varieties_select_backoffice_and_growers" on public.product_varieties
  for select
  to authenticated
  using (public.current_role() in ('backoffice', 'grower'));

-- ---------------------------------------------------------------------------
-- 2. get_orderable_catalog_for_customer: runs as its owner, checks its caller
-- ---------------------------------------------------------------------------
--
-- It has to become security definer, because it joins product_varieties and
-- its customer callers can no longer read that table themselves. Everything
-- it returns was already scoped explicitly by v_target_company_id rather than
-- left to RLS, so running as the owner changes no one's result — except that
-- its caller check now has to hold on its own:
--
-- SECURITY: ALLOWS a signed-in user with a profile to read the catalog for
-- THEIR OWN company (a customer ordering; a grower, as before), and backoffice
-- to read any customer's (the on-behalf-of screens). It PROTECTS AGAINST
--   - a customer passing another company's id: refused, as before;
--   - a caller with no profile at all. The old check was
--     `current_role() <> 'backoffice'`, which is NULL — not true — when there
--     is no profile, so such a caller slipped past it; RLS then hid the other
--     company's order lines, but running as the owner there would be no RLS
--     to do so. `is distinct from` makes NULL count as "not backoffice", and a
--     caller with no company of their own is refused outright;
--   - anonymous calls: execute is revoked from anon below.
-- The price blanking (`case when ds.can_see_prices ...`) is unchanged, and is
-- now the ONLY way a customer sees a price.
create or replace function public.get_orderable_catalog_for_customer(
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
security definer
set search_path = public
stable
as $$
declare
  v_target_company_id uuid;
begin
  if p_customer_company_id is not null then
    if public.current_role() is distinct from 'backoffice' then
      raise exception 'FORBIDDEN: only backoffice may query another company''s catalog' using errcode = '42501';
    end if;
    v_target_company_id := p_customer_company_id;
  else
    v_target_company_id := public.current_company_id();
    if v_target_company_id is null then
      raise exception 'FORBIDDEN: no profile for this account' using errcode = '42501';
    end if;
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
  'Security definer (migration 0056), so customers — who cannot read product_varieties directly — can still browse the catalog. A signed-in user with a profile reads their own company''s catalog (p_customer_company_id omitted); backoffice may pass p_customer_company_id to read any customer''s — raises FORBIDDEN for any other caller, and for an account with no profile. Prices are returned only when the day''s daily_shops.can_see_prices is on; this is the only way a customer sees a price. sizes is the variety''s free-text size descriptor (product_varieties.sizes), meant to be shown beside variety_name. image_url is the variety''s family''s photo. max_orderable_for_customer is the target company''s own ceiling for that row (see max_orderable_for_customer()) — always populated, including on the backoffice on-behalf-of path, but only the customer''s own order screen''s UI treats it as a hard limit; the backoffice edit path lets staff override it.';

revoke execute on function public.get_orderable_catalog_for_customer(uuid, uuid) from public, anon;
grant execute on function public.get_orderable_catalog_for_customer(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_customer_order_lines: a closed order's lines, for its own customer
-- ---------------------------------------------------------------------------
--
-- Replaces ClosedOrderView's direct read of daily_order_products embedding
-- product_varieties, which returns no variety (and so no product names) once
-- customers can't read that table. Returns only the columns that screen
-- shows — no price, no overbooking, no cap.
--
-- SECURITY: security definer, so it can join product_varieties for a
-- customer. It ALLOWS the order's own customer (its customer_company_id is the
-- caller's company) and backoffice to read that order's lines. It PROTECTS
-- AGAINST anyone else — another customer, a grower, an account with no
-- profile — reading an order that isn't theirs: for them the WHERE clause
-- matches nothing and the result is empty, exactly as RLS on daily_orders
-- already makes that order invisible to them. Execute is revoked from anon.
create or replace function public.get_customer_order_lines(p_daily_order_id uuid)
returns table (
  id uuid,
  pallets_ordered numeric,
  comment text,
  variety_name text,
  family_id uuid,
  family_name text,
  image_url text,
  pack_type public.pack_type
)
language sql
security definer
set search_path = public
stable
as $$
  select
    dop.id,
    dop.pallets_ordered,
    dop.comment,
    pv.name,
    pv.family_id,
    pf.name,
    pf.image_url,
    pv.pack_type
  from public.daily_order_products dop
  join public.daily_orders o on o.id = dop.daily_order_id
  join public.product_varieties pv on pv.id = dop.product_variety_id
  join public.product_families pf on pf.id = pv.family_id
  where dop.daily_order_id = p_daily_order_id
    and (
      o.customer_company_id = public.current_company_id()
      or public.current_role() = 'backoffice'
    )
  order by dop.product_variety_id;
$$;

comment on function public.get_customer_order_lines(uuid) is
  'One order''s lines with their variety and family names (migration 0056) — no price. Security definer so a customer, who cannot read product_varieties directly, can see their own order''s product names. Returns rows only to the order''s own customer and to backoffice; anyone else gets an empty result.';

revoke execute on function public.get_customer_order_lines(uuid) from public, anon;
grant execute on function public.get_customer_order_lines(uuid) to authenticated;
