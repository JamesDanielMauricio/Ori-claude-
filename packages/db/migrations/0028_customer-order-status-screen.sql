-- Customer Order Status screen (backoffice's "Distributor as Customer"
-- view, `tab=distributor+customer` in the source — no dedicated PRD node
-- beyond backoffice.md's one-line table entry, same situation Prompt 6's
-- Grower Inventory Status screen was in; built by mirroring that
-- screen's own pattern) and the Order History (Arrangement + Orders by
-- Date) screen's one missing piece.

alter table "public"."daily_orders" add column "reminder_sent_at" timestamp with time zone;

comment on column "public"."daily_orders"."reminder_sent_at" is
  'Set by send_order_reminder (the distributor''s "remind this customer" action on the Customer Order Status screen) — mirrors daily_picks.reminder_sent_at exactly.';

-- get_orderable_catalog_for_customer, extended: an optional
-- p_customer_company_id lets a BACKOFFICE caller read a specific
-- customer's own catalog+cart view — the exact same computation the
-- customer's own order screen uses, not a second implementation (R5/R6).
-- The function's original design deliberately took no such parameter at
-- all, specifically to remove any spoofing surface for a non-backoffice
-- caller (see 0018's own comment) — that stays true here: a non-backoffice
-- caller supplying a non-null value is rejected outright with FORBIDDEN,
-- not silently filtered by RLS the way a parameter alone would only
-- half-protect against. Converted from `language sql` to `language
-- plpgsql` to make that explicit check possible; behavior for every
-- existing customer caller (p_customer_company_id omitted) is byte-for-
-- byte identical to the original query.
create or replace function public.get_orderable_catalog_for_customer(
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
  comment text
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
    dop.comment
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
  'Any authenticated user for their own company (p_customer_company_id omitted). Backoffice-only when p_customer_company_id is supplied — raises FORBIDDEN for any other caller, not just RLS-filtered. The single source of truth for which varieties a customer may currently order, shared by the customer''s own order screen and the backoffice Customer Order Status screen (apps/web/src/app/(backoffice)/backoffice/distributor-customer/).';

grant execute on function public.get_orderable_catalog_for_customer(uuid, uuid) to authenticated;

-- submit_order, extended the same way: an optional p_customer_company_id,
-- backoffice-only, lets the distributor create/edit an order on a
-- customer's behalf through the exact same transaction every customer
-- submission already goes through — not a second order-writing path.
-- order_submission_logs.submitted_by still records auth.uid() (whoever
-- actually clicked submit — the distributor, here), matching how
-- update_pick_product_pallets/details already attribute an
-- on-behalf-of edit to the real actor, not the record's owner.
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
  v_line jsonb;
  v_kept_ids uuid[] := '{}';
  v_line_id uuid;
  v_pallets numeric;
  v_comment text;
  v_variety_id uuid;
  v_customer_company_id uuid;
begin
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
    and customer_company_id = v_customer_company_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: no daily order exists for this company on this trading day' using errcode = 'P0002';
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

comment on function public.submit_order(uuid, jsonb, uuid) is
  'Customer-only for their own company (p_customer_company_id omitted). Backoffice-only when p_customer_company_id is supplied. One transaction: upserts-and-prunes daily_order_products from p_lines, sets the order to submitted and stamps submitted_at, and writes one order_submission_logs row (attributed to whoever actually called this — auth.uid() — not the order''s own company). Raises P0007 if the trading day is closed, P0008 if a line references a variety not in today''s shop or has a negative pallet count.';

grant execute on function public.submit_order(uuid, jsonb, uuid) to authenticated;

-- send_order_reminder — the distributor's "remind this customer" action
-- on the Customer Order Status screen, mirroring send_pick_reminder
-- exactly, except this one actually dispatches: send_pick_reminder
-- predates the notifications module (Prompt 9) and was left a stub by
-- design at the time ("no integration exists yet"); this function
-- doesn't have that excuse anymore, so it writes a real
-- notification_outbox row. Whether to retrofit send_pick_reminder the
-- same way is a separate, undecided follow-up — not done here.
create or replace function public.send_order_reminder(p_daily_order_id uuid)
returns public.daily_orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.daily_orders;
  v_trade_date date;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_order from public.daily_orders where id = p_daily_order_id for update;
  if not found then
    raise exception 'NOT_FOUND: order % does not exist', p_daily_order_id using errcode = 'P0002';
  end if;

  if v_order.status = 'submitted' then
    raise exception 'INVALID_STATE: cannot send a reminder about an order that''s already been submitted' using errcode = 'P0007';
  end if;

  select trade_date into v_trade_date from public.trading_days where id = v_order.trading_day_id;

  update public.daily_orders
  set reminder_sent_at = now()
  where id = p_daily_order_id
  returning * into v_order;

  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  values (
    v_order.trading_day_id, 'customer', v_order.customer_company_id, 'order_reminder',
    jsonb_build_object('tradeDate', v_trade_date, 'lines', '[]'::jsonb)
  );

  return v_order;
end;
$$;

comment on function public.send_order_reminder(uuid) is
  'Backoffice-only. Stamps reminder_sent_at on the customer''s Daily Order and writes one notification_outbox row (template_key ''order_reminder'', gated at drain time by the global WhatsApp toggle only — not the close-arrangement-specific one). Raises P0007 if the order has already been submitted.';

grant execute on function public.send_order_reminder(uuid) to authenticated;

insert into public.notification_templates (template_key, channel, title, content, link) values
  (
    'order_reminder',
    'whatsapp',
    'תזכורת להזמנה',
    '%FIRST_NAME% שלום,%NL%זוהי תזכורת לשלוח הזמנה ליום %CURRENT_OPEN_BUSINESS_DAY%.',
    null
  );
