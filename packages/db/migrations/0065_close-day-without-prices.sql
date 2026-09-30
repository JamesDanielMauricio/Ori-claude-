-- Closing the business day no longer stops for a product that has no price.
--
-- The rule until now (migration 0022): populate_arrangement_prices, which
-- close_arrangement calls in the middle of its transaction, raised
-- INVALID_STATE ("cannot close arrangement — <product> has no price or price
-- range configured") whenever an arrangement record had no price of its own
-- and its product had neither a fixed price nor a full price range. That
-- rolled the whole close back, so a single unpriced product kept the trading
-- day open until someone went and priced it.
--
-- The rule from now on, by the distributor's own decision: the day always
-- closes. A record that cannot be priced is closed as it stands, with its
-- price left empty (null) — nothing is invented for it and nothing blocks.
-- This is a deliberate reversal of 0022's "stop the whole close rather than
-- finalize partial pricing", not an oversight; see docs/SCHEMA_DECISIONS.md.
--
-- What does NOT change, so a day that closed before closes exactly the same:
--   - a record that already carries its own price keeps it (never overwritten);
--   - a product's fixed price wins, otherwise the midpoint of its price range
--     (a range needs both ends);
--   - price_type is copied from the product when the record has none;
--   - the signature and the return value (how many records were priced), so
--     close_arrangement, which calls this, keeps working untouched — only its
--     description (the comment at the bottom) is brought up to date.
--
-- Nothing downstream needs a price to be there: the customers' end-of-day
-- message leaves the price out when it is empty (compose_order_details_text,
-- 0052), exactly what it already does on a day that hides prices from
-- customers.
--
-- Safe to run more than once (create or replace, comment on).
create or replace function public.populate_arrangement_prices(p_trading_day_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated integer;
begin
  -- SECURITY: ALLOWS a backoffice account to run this. PROTECTS AGAINST a
  -- grower or customer calling it straight through the API (it is executable
  -- by every signed-in account, like the other lifecycle functions) and
  -- writing prices onto the day's arrangement records, which only the
  -- distributor may set. Unchanged from 0022. A caller with no profile at all
  -- has a NULL role, and NULL <> 'backoffice' does not raise, so that caller
  -- is stopped by the table's own row-level security instead: this function
  -- runs as its caller (security invoker), so its UPDATE below can only touch
  -- rows that caller is allowed to update, which for arrangement_records is
  -- backoffice alone.
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  -- Only a record that CAN be priced is touched: its product has a fixed
  -- price, or both ends of a price range. The condition at the bottom is the
  -- exact opposite of the one 0022 raised on ("no price, and a range that is
  -- missing an end"), so a record 0022 could price is priced the same way as
  -- before, and a record it refused is now simply skipped — it keeps its
  -- null price instead of aborting the close.
  update public.arrangement_records ar
  set price = coalesce(pv.price, (pv.price_range_from + pv.price_range_to) / 2),
      price_type = coalesce(ar.price_type, pv.price_type),
      updated_at = now()
  from public.daily_pick_products dpp
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  join public.product_varieties pv on pv.id = dpp.product_variety_id
  where ar.daily_pick_product_id = dpp.id
    and dp.trading_day_id = p_trading_day_id
    and ar.price is null
    and (
      pv.price is not null
      or (pv.price_range_from is not null and pv.price_range_to is not null)
    );

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

comment on function public.populate_arrangement_prices(uuid) is
  'Backoffice-only. Fills price/price_type on any un-priced arrangement_records row for this trading day: the variety''s fixed price if set, otherwise the midpoint of its price range (both ends required). A row whose variety has neither is left exactly as it is, price null — this function never raises for it, so a missing price can never keep a day from closing (migration 0065; 0022 used to raise P0007 here). Returns how many rows it priced.';

-- close_arrangement's body is untouched; only the description changes, since
-- the old one promised a failure that can no longer happen.
comment on function public.close_arrangement() is
  'Backoffice-only. Phase 4 (terminal), one transaction: mass-closes every Daily Pick (backfilling pickup_time and submitted_at for any pick that never went through submit_pick — see migrations 0043/0044), computes end-of-day leftovers, populates arrangement prices (a record whose product has no price or price range is closed with its price left empty — migration 0065), closes the arrangement, clears price-fluctuation highlights, closes the trading day, writes the notification outbox, and logs an end_the_day session — all in the same function call, so a failure at any step rolls back every step before it. Raises P0007 if the day is not in phase "shop_closed".';
