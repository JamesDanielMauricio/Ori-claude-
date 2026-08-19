-- Close Arrangement, finished (R4): the source's nine-action workflow
-- collapses into one transaction here — arrangement status, mass pick
-- close, leftovers, price population, and notification-outbox writes all
-- land together or not at all, since they're all just statements inside
-- one plpgsql function body. This migration adds the two pieces Prompt 5
-- didn't need yet (price population, notification outbox) and wires them
-- into close_arrangement as direct calls, in the same transaction — never
-- a trigger relay, per the same R5 reasoning already applied to
-- close_out_pick_leftovers.

-- 1. populate_arrangement_prices — replaces the source's separately
--    triggered `populate prices` custom event (action 9) with a function
--    called directly from close_arrangement's body. Only fills gaps
--    (price IS NULL) — an explicit per-record price set at
--    create/update_arrangement_record time is never overwritten.
create or replace function public.populate_arrangement_prices(p_trading_day_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated integer;
  v_unpriceable_variety text;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  -- A record close_arrangement can't price (its variety has neither a
  -- fixed price nor a valid range) is a real data problem, not something
  -- to silently leave null on an otherwise-closed arrangement — stop the
  -- whole close here rather than finalize partial pricing.
  select pv.name into v_unpriceable_variety
  from public.arrangement_records ar
  join public.daily_pick_products dpp on dpp.id = ar.daily_pick_product_id
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  join public.product_varieties pv on pv.id = dpp.product_variety_id
  where dp.trading_day_id = p_trading_day_id
    and ar.price is null
    and pv.price is null
    and (pv.price_range_from is null or pv.price_range_to is null)
  limit 1;

  if v_unpriceable_variety is not null then
    raise exception 'INVALID_STATE: cannot close arrangement — % has no price or price range configured', v_unpriceable_variety
      using errcode = 'P0007';
  end if;

  update public.arrangement_records ar
  set price = coalesce(pv.price, (pv.price_range_from + pv.price_range_to) / 2),
      price_type = coalesce(ar.price_type, pv.price_type),
      updated_at = now()
  from public.daily_pick_products dpp
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  join public.product_varieties pv on pv.id = dpp.product_variety_id
  where ar.daily_pick_product_id = dpp.id
    and dp.trading_day_id = p_trading_day_id
    and ar.price is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

comment on function public.populate_arrangement_prices(uuid) is
  'Backoffice-only. Fills price/price_type on any un-priced arrangement_records row for this trading day: the variety''s fixed price if set, otherwise the midpoint of its price range. Raises P0007 if any un-priced record''s variety has neither — a close_arrangement can''t finalize a price it has no configuration for.';

grant execute on function public.populate_arrangement_prices(uuid) to authenticated;

-- 2. build_notification_outbox — replaces the source's synchronous
--    WhatsApp dispatch (actions 7/8) with a durable, transactional insert.
--    One row per grower/customer company that actually has arranged
--    pallets for the day; the payload is the full arrangement summary
--    that payload, so the drain job (a later prompt) can format a message
--    without re-deriving anything from a day that, by the time it runs,
--    is already closed.
create or replace function public.build_notification_outbox(p_trading_day_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_can_see_prices boolean;
  v_trade_date date;
  v_customer_count integer;
  v_grower_count integer;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select ds.can_see_prices, td.trade_date into v_can_see_prices, v_trade_date
  from public.daily_shops ds
  join public.trading_days td on td.id = ds.trading_day_id
  where ds.trading_day_id = p_trading_day_id;

  -- Customer batch: every customer company with arranged pallets on a
  -- submitted order — matches the source's "arrangement records (> 0
  -- pallets) AND orders (status ≠ Open)" criterion.
  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, payload)
  select
    p_trading_day_id, 'customer', ar.customer_company_id,
    jsonb_build_object(
      'tradeDate', v_trade_date,
      'canSeePrices', coalesce(v_can_see_prices, false),
      'lines', jsonb_agg(jsonb_build_object(
        'familyName', pf.name,
        'varietyName', pv.name,
        'quantityPallets', ar.quantity_pallets,
        'price', case when v_can_see_prices then ar.price else null end,
        'growerCompanyName', gc.name
      ))
    )
  from public.arrangement_records ar
  join public.daily_order_products dop on dop.id = ar.daily_order_product_id
  join public.daily_orders do2 on do2.id = dop.daily_order_id
  join public.product_varieties pv on pv.id = dop.product_variety_id
  join public.product_families pf on pf.id = pv.family_id
  join public.daily_pick_products dpp on dpp.id = ar.daily_pick_product_id
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  join public.companies gc on gc.id = dp.grower_company_id
  where do2.trading_day_id = p_trading_day_id
    and ar.quantity_pallets > 0
    and do2.status <> 'open'
  group by ar.customer_company_id;
  get diagnostics v_customer_count = row_count;

  -- Grower batch: every grower company whose pick contributed arranged
  -- pallets.
  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, payload)
  select
    p_trading_day_id, 'grower', dp.grower_company_id,
    jsonb_build_object(
      'tradeDate', v_trade_date,
      'lines', jsonb_agg(jsonb_build_object(
        'familyName', pf.name,
        'varietyName', pv.name,
        'quantityPallets', ar.quantity_pallets,
        'customerCompanyName', cc.name
      ))
    )
  from public.arrangement_records ar
  join public.daily_pick_products dpp on dpp.id = ar.daily_pick_product_id
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  join public.product_varieties pv on pv.id = dpp.product_variety_id
  join public.product_families pf on pf.id = pv.family_id
  join public.companies cc on cc.id = ar.customer_company_id
  where dp.trading_day_id = p_trading_day_id
    and ar.quantity_pallets > 0
  group by dp.grower_company_id;
  get diagnostics v_grower_count = row_count;

  return v_customer_count + v_grower_count;
end;
$$;

comment on function public.build_notification_outbox(uuid) is
  'Backoffice-only. Writes one notification_outbox row per grower/customer company with arranged pallets for this trading day — a durable, transactional stand-in for the source''s synchronous WhatsApp dispatch. A later prompt''s Edge Function drains this table and performs the actual send after this transaction has committed. Returns the number of rows written.';

grant execute on function public.build_notification_outbox(uuid) to authenticated;

-- 3. close_arrangement, extended: price population and the notification
--    outbox are now two more statements in the same function body — same
--    transaction as everything else here, by construction, not by a
--    guarantee anyone has to remember to preserve.
create or replace function public.close_arrangement()
returns public.lifecycle_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
  v_session public.lifecycle_sessions;
  v_draft_picks jsonb;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_day from public.trading_days where phase <> 'closed' for update;
  if not found then
    raise exception 'NOT_FOUND: no trading day is open' using errcode = 'P0002';
  end if;
  if v_day.phase <> 'shop_closed' then
    raise exception 'INVALID_STATE: cannot close arrangement — trading day is in phase %, expected shop_closed', v_day.phase
      using errcode = 'P0007';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'dailyPickId', dp.id,
           'growerCompanyId', dp.grower_company_id,
           'growerCompanyName', c.name,
           'status', dp.status
         )), '[]'::jsonb)
    into v_draft_picks
  from public.daily_picks dp
  join public.companies c on c.id = dp.grower_company_id
  where dp.trading_day_id = v_day.id
    and dp.status = 'draft';

  update public.daily_picks set status = 'closed', updated_at = now() where trading_day_id = v_day.id;

  -- R6: one direct call, same transaction — see this file's header.
  perform public.close_out_pick_leftovers(v_day.id);

  -- R4: price population is part of this same transaction, not a
  -- separately triggered step that can desync from the status change.
  -- Raises (and rolls back everything above) if any arrangement record
  -- can't be priced.
  perform public.populate_arrangement_prices(v_day.id);

  update public.daily_arrangements
  set status = 'closed', closed_at = now()
  where trading_day_id = v_day.id;

  update public.product_varieties set highlight_price_fluctuations = false
  where highlight_price_fluctuations = true;

  update public.trading_days set phase = 'closed', updated_at = now() where id = v_day.id;

  -- R4's external-system carve-out: this writes a durable outbox row,
  -- never an outbound HTTP call, so it's safe inside this transaction —
  -- see build_notification_outbox's own comment.
  perform public.build_notification_outbox(v_day.id);

  insert into public.lifecycle_sessions (trading_day_id, session_type, performed_by, metadata)
  values (v_day.id, 'end_the_day', (select auth.uid()), jsonb_build_object('draftPicksForceClosed', v_draft_picks))
  returning * into v_session;

  return v_session;
end;
$$;

comment on function public.close_arrangement() is
  'Backoffice-only. Phase 4 (terminal), one transaction: mass-closes every Daily Pick, computes end-of-day leftovers, populates arrangement prices, closes the arrangement, clears price-fluctuation highlights, closes the trading day, writes the notification outbox, and logs an end_the_day session — all in the same function call, so a failure at any step (e.g. an unpriceable variety) rolls back every step before it. Raises P0007 if the day is not in phase "shop_closed", or if any arrangement record can''t be priced.';
