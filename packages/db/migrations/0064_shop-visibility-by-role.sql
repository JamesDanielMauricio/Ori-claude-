-- Who sees which products in the shop: customers and distributors are shown
-- different lists. Follows 0063, which made the shop list only products that
-- have picking; this replaces the same function again, so it is safe to run
-- whether or not 0063 was run first.
--
-- Terms used below:
--   picking      = pallets_picked + leftover_pallets, added up over every
--                  grower's line for the variety on that day. Overbooking is
--                  not picking.
--   fully ordered = picking + no_overbooking <= everything customers have
--                  ordered of it. This is `not is_orderable`, unchanged.
--
--   A CUSTOMER (their own order screen) sees a product when it has picking
--   AND it is not fully ordered. One exception, kept on purpose: a product
--   that has picking and is already in THEIR OWN order stays, even when fully
--   ordered, so they can still see and change what they ordered.
--
--   A DISTRIBUTOR (backoffice: the "בשם לקוח" screen and the arrangement
--   board's order dialog) sees every product that has picking, fully ordered
--   or not — is_orderable comes back false for those, which the screen shows
--   as "אזל מהמלאי" — plus every line already in the customer's order.
--
--   A product with NO picking is in neither list (an overbooking allowance
--   does not change that), with one difference: it stays on a distributor's
--   screen when it is already in the order being looked at.
--
-- What changes compared with 0063:
--   1. A product a customer already ordered whose picking has since dropped
--      to 0 is no longer on that customer's screen (0063 kept it). Because the
--      order screen sends back only the rows it shows, and submit_order removes
--      every order line it is not sent, the customer's next save removes that
--      line. That is the agreed behaviour: a product with no picking is not
--      part of the shop. (A line with something arranged against it would be
--      zeroed rather than deleted, but picking cannot be lowered below what is
--      arranged — save_pick_lines refuses with P0006 — so such a line still has
--      picking and stays on the screen. This only ever meets lines nobody can
--      fulfil.)
--   2. A distributor now also sees fully ordered products (0063, like every
--      version before it, hid them from everyone who had not ordered them).
--      Staff may deliberately order past what is left — submit_order does not
--      apply the customer's ceiling to them — and until now they could not
--      even find such a product on this screen.
--   Everything else — columns, values, order, prices, caller checks — is as in
--   0063 and 0056.
--
-- The distributor's list also keeps every existing order line visible whatever
-- its picking, so saving there can never remove a line the distributor cannot
-- see.

-- SECURITY: which of the two lists a caller gets is decided by their ROLE, read
-- from their profile (current_role()), never by anything they pass in. That
-- ALLOWS backoffice to see fully ordered products and existing order lines
-- that customers do not, and it PROTECTS AGAINST a customer asking for the
-- distributor's list: there is no parameter that switches it, and the only
-- parameter that reaches another company's catalog (p_customer_company_id) is
-- still refused for everyone but backoffice (42501).
-- The rest is unchanged from 0056 and restated because the function is
-- replaced. ALLOWS a signed-in user with a profile to read the catalog for
-- THEIR OWN company (a customer ordering; a grower), and backoffice to read any
-- customer's. It PROTECTS AGAINST
--   - a caller with no profile: `is distinct from` counts "no role" as "not
--     backoffice", and a caller with no company of their own is refused
--     outright — this function runs as its owner, so RLS is not there to
--     catch either case;
--   - anonymous calls: execute is revoked from anon below.
-- The picking check reads every grower's pick lines, which the caller could
-- not read themselves. It adds nothing to what leaves this function: it only
-- decides whether a row is listed at all, and the picking total itself is
-- never returned — no pick line and no other company's figure.
-- Prices are still blanked unless the day's daily_shops.can_see_prices is on.
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
  v_staff_view boolean;
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

  -- The distributor's list or the customer's, by role. `coalesce` because a
  -- role of NULL (no profile) must count as "not backoffice"; such a caller is
  -- refused above anyway.
  v_staff_view := coalesce(public.current_role() = 'backoffice', false);

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
  -- Picking per variety for this day, across every grower and whatever the
  -- state of their pick (a draft counts, as it does in shop_variety_orderability).
  -- Both columns are NOT NULL, so the sum is never null.
  left join (
    select dpp.product_variety_id, sum(dpp.pallets_picked) + sum(dpp.leftover_pallets) as total
    from public.daily_pick_products dpp
    join public.daily_picks dp on dp.id = dpp.daily_pick_id
    where dp.trading_day_id = p_trading_day_id
    group by dpp.product_variety_id
  ) picking on picking.product_variety_id = pv.id
  left join public.daily_orders ord
    on ord.trading_day_id = p_trading_day_id
    and ord.customer_company_id = v_target_company_id
  left join public.daily_order_products dop
    on dop.daily_order_id = ord.id
    and dop.product_variety_id = pv.id
  where
    -- A customer: has picking, and either still has room to order or is already
    -- in their own order. no_overbooking is deliberately not part of "has
    -- picking": it only stretches how much of a picked product can be ordered
    -- (that is is_orderable's job), it is not stock.
    (not v_staff_view
      and coalesce(picking.total, 0) > 0
      and (sv.is_orderable or dop.id is not null))
    -- A distributor: everything that has picking, fully ordered or not, plus
    -- whatever is already in the order they are looking at.
    or (v_staff_view
      and (coalesce(picking.total, 0) > 0 or dop.id is not null))
  order by pf.name, pv.name;
end;
$$;

comment on function public.get_orderable_catalog_for_customer(uuid, uuid) is
  'Security definer (migration 0056), so customers — who cannot read product_varieties directly — can still browse the catalog. A signed-in user with a profile reads their own company''s catalog (p_customer_company_id omitted); backoffice may pass p_customer_company_id to read any customer''s — raises FORBIDDEN for any other caller, and for an account with no profile. Customers and distributors get different lists, chosen by the caller''s role (never by a parameter), migration 0064. Picking = pallets_picked + leftover_pallets summed over every grower for the day; no_overbooking is not picking. A CUSTOMER sees a variety when it has picking AND it is not fully ordered (is_orderable), or when it has picking and is already in their own order (so a fully ordered product stays visible to whoever ordered it). A variety whose picking is 0 is not shown to a customer even if it is in their order. A DISTRIBUTOR (backoffice) sees every variety that has picking, fully ordered or not (is_orderable is false for those), plus every line already in the target company''s order whatever its picking. Prices are returned only when the day''s daily_shops.can_see_prices is on; this is the only way a customer sees a price. sizes is the variety''s free-text size descriptor (product_varieties.sizes), meant to be shown beside variety_name. image_url is the variety''s family''s photo. max_orderable_for_customer is the target company''s own ceiling for that row (see max_orderable_for_customer()) — always populated, including on the backoffice on-behalf-of path, but only the customer''s own order screen''s UI treats it as a hard limit; the backoffice edit path lets staff override it.';

-- SECURITY: ALLOWS only signed-in users to run the function; PROTECTS AGAINST
-- anonymous callers (no session) reaching it at all. `create or replace` keeps
-- the grants it had, and these two lines state them again so this file is the
-- whole truth about who may call it.
revoke execute on function public.get_orderable_catalog_for_customer(uuid, uuid) from public, anon;
grant execute on function public.get_orderable_catalog_for_customer(uuid, uuid) to authenticated;
