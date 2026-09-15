-- Thread product_varieties.sizes through the WhatsApp order-details line
-- items — same "show the size beside the name" rule as 0051's catalog RPC
-- change, applied to build_notification_outbox's three payload builders
-- (customer/grower/transporter, all close_arrangement_* templates) and to
-- compose_order_details_text, the single formatter both resolve_outbox_
-- dispatch and resolve_outbox_preview call (0046) to turn that payload into
-- the message body's line-item text.

-- build_notification_outbox: byte-for-byte identical to 0031's version
-- apart from adding 'varietySizes', pv.sizes to each of the three
-- jsonb_build_object line-builders. create or replace is safe here — the
-- return type (integer) is unchanged.
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
  v_transporter_count integer;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select ds.can_see_prices, td.trade_date into v_can_see_prices, v_trade_date
  from public.daily_shops ds
  join public.trading_days td on td.id = ds.trading_day_id
  where ds.trading_day_id = p_trading_day_id;

  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  select
    p_trading_day_id, 'customer', ar.customer_company_id, 'close_arrangement_customer',
    jsonb_build_object(
      'tradeDate', v_trade_date,
      'canSeePrices', coalesce(v_can_see_prices, false),
      'lines', jsonb_agg(jsonb_build_object(
        'familyName', pf.name,
        'varietyName', pv.name,
        'varietySizes', pv.sizes,
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

  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  select
    p_trading_day_id, 'grower', dp.grower_company_id, 'close_arrangement_grower',
    jsonb_build_object(
      'tradeDate', v_trade_date,
      'lines', jsonb_agg(jsonb_build_object(
        'familyName', pf.name,
        'varietyName', pv.name,
        'varietySizes', pv.sizes,
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

  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  select
    p_trading_day_id, 'transporter', gc.transporter_company_id, 'close_arrangement_grower',
    jsonb_build_object(
      'tradeDate', v_trade_date,
      'lines', jsonb_agg(jsonb_build_object(
        'familyName', pf.name,
        'varietyName', pv.name,
        'varietySizes', pv.sizes,
        'quantityPallets', ar.quantity_pallets,
        'customerCompanyName', cc.name
      ))
    )
  from public.arrangement_records ar
  join public.daily_pick_products dpp on dpp.id = ar.daily_pick_product_id
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  join public.companies gc on gc.id = dp.grower_company_id
  join public.product_varieties pv on pv.id = dpp.product_variety_id
  join public.product_families pf on pf.id = pv.family_id
  join public.companies cc on cc.id = ar.customer_company_id
  where dp.trading_day_id = p_trading_day_id
    and ar.quantity_pallets > 0
    and gc.transporter_company_id is not null
  group by dp.grower_company_id, gc.transporter_company_id;
  get diagnostics v_transporter_count = row_count;

  return v_customer_count + v_grower_count + v_transporter_count;
end;
$$;

comment on function public.build_notification_outbox(uuid) is
  'Backoffice-only. Writes one notification_outbox row per grower/customer company with arranged pallets for this trading day, plus one more per grower with an assigned transporter (id 8 — same close_arrangement_grower template content, cc''d to the transporter, one message per grower even if a transporter serves several) — a durable, transactional stand-in for the source''s synchronous WhatsApp dispatch. Each line carries varietySizes (product_varieties.sizes) alongside varietyName, for compose_order_details_text to show beside the name. Returns the number of rows written.';

-- compose_order_details_text: fold varietySizes into the format string,
-- right after varietyName and before the price suffix — "%s — %s%s%s: %s
-- משטחים (%s)" instead of 0046's "%s — %s%s: %s משטחים (%s)". Blank/null
-- sizes contribute nothing (same "omit when absent" rule products.tsx's own
-- admin table column already uses), so a variety with no size recorded
-- prints exactly as before — this is why the existing notifications.test.ts
-- substring assertions (e.g. on "בננה — צהובה") keep passing untouched.
create or replace function public.compose_order_details_text(p_payload jsonb)
returns text
language sql
immutable
as $$
  select string_agg(
    format(
      '%s — %s%s%s: %s משטחים (%s)',
      line ->> 'familyName',
      line ->> 'varietyName',
      case when coalesce(line ->> 'varietySizes', '') <> '' then format(' %s', line ->> 'varietySizes') else '' end,
      case when line ->> 'price' is not null then format(' — ₪%s', line ->> 'price') else '' end,
      line ->> 'quantityPallets',
      coalesce(line ->> 'growerCompanyName', line ->> 'customerCompanyName')
    ),
    chr(10)
    order by line ->> 'familyName', line ->> 'varietyName'
  )
  from jsonb_array_elements(p_payload -> 'lines') as line;
$$;
