-- The customer shop lists a product only when it has picking.
--
-- "Picking" is the stock growers have for the day: pallets_picked plus
-- leftover_pallets (stock carried over from an earlier day), added up over
-- every grower's line for that variety. A product with 0 of both is not in
-- the shop.
--
-- Until now the catalog did not check that. A variety was listed when
--
--   pallets_picked + leftover_pallets + no_overbooking > pallets ordered
--
-- (the out-of-stock formula from the PRD, 0018). no_overbooking is a buffer
-- ABOVE picking: how far past what growers have a product may still be
-- ordered. But the sum also passes when there is no picking at all. A product
-- nobody had picked, with no leftover, but with an overbooking allowance of 3,
-- gives 0 + 0 + 3 > 0 — so it was listed to every customer and could be
-- ordered up to 3 pallets, although no grower had any. The shop showed
-- products with no picking.
--
-- The catalog now also requires picking > 0. It is one more condition in the
-- WHERE clause and nothing else: every row the function still returns is
-- exactly what it returned before (same columns, same values, same order).
--
-- What does NOT change, on purpose:
--   * A product WITH picking is still orderable past it, by its overbooking
--     allowance, and still drops out once picking + overbooking is fully
--     ordered — is_orderable and max_orderable_for_customer are untouched.
--   * A product already in the caller's own order for the day is still listed
--     whatever its picking has become (the per-customer carve-out from 0018).
--     This one is a safety rule, not a shop rule: submit_order removes every
--     order line the screen does not send back (deleted, or zeroed if
--     something is arranged against it), so a customer whose grower later
--     lowered a product to 0 would otherwise lose their line without ever
--     seeing it, the next time they saved a different product.
--   * Prices, image_url and the caller checks: all as in 0056.
--
-- Both order screens read this function — the customer's own, and the
-- distributor's "בשם לקוח" (p_customer_company_id supplied) — so both follow
-- the rule. submit_order is not touched: a product that is no longer listed
-- cannot be reached from either screen.

-- SECURITY: unchanged from 0056, restated because the function is replaced.
-- ALLOWS a signed-in user with a profile to read the catalog for THEIR OWN
-- company (a customer ordering; a grower), and backoffice to read any
-- customer's (the on-behalf-of screens). It PROTECTS AGAINST
--   - a customer passing another company's id: refused (42501);
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
  -- Listed when it has picking AND still has room to order, or when it is
  -- already in this customer's own order. no_overbooking is deliberately not
  -- part of "has picking": it only stretches how much of a picked product can
  -- be ordered (that is is_orderable's job), it is not stock.
  where (sv.is_orderable and coalesce(picking.total, 0) > 0)
    or dop.id is not null
  order by pf.name, pv.name;
end;
$$;

comment on function public.get_orderable_catalog_for_customer(uuid, uuid) is
  'Security definer (migration 0056), so customers — who cannot read product_varieties directly — can still browse the catalog. A signed-in user with a profile reads their own company''s catalog (p_customer_company_id omitted); backoffice may pass p_customer_company_id to read any customer''s — raises FORBIDDEN for any other caller, and for an account with no profile. Lists a variety only when it has picking on the day (pallets_picked + leftover_pallets, summed over every grower, more than 0 — no_overbooking does not count, migration 0063) AND it still has room to order (is_orderable), or when it is already in the target company''s own order for the day (kept so re-saving an order never silently drops a line the customer cannot see). Prices are returned only when the day''s daily_shops.can_see_prices is on; this is the only way a customer sees a price. sizes is the variety''s free-text size descriptor (product_varieties.sizes), meant to be shown beside variety_name. image_url is the variety''s family''s photo. max_orderable_for_customer is the target company''s own ceiling for that row (see max_orderable_for_customer()) — always populated, including on the backoffice on-behalf-of path, but only the customer''s own order screen''s UI treats it as a hard limit; the backoffice edit path lets staff override it.';

-- SECURITY: ALLOWS only signed-in users to run the function; PROTECTS AGAINST
-- anonymous callers (no session) reaching it at all. `create or replace` keeps
-- the grants it had, and these two lines state them again so this file is the
-- whole truth about who may call it.
revoke execute on function public.get_orderable_catalog_for_customer(uuid, uuid) from public, anon;
grant execute on function public.get_orderable_catalog_for_customer(uuid, uuid) to authenticated;
