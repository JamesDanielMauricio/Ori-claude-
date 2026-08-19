-- NotificationService's Postgres-side surface (R5): the business logic
-- behind the WhatsApp adapter — template substitution, recipient
-- routing, and in-app alert creation — lives here as named functions,
-- the same way every other cross-cutting computation in this project
-- does, rather than in the Edge Function's Deno code. That keeps the
-- part that actually needs correctness testing inside this project's one
-- established testing pattern (vitest against the real remote database),
-- and leaves the Edge Function itself as thin wiring: fetch pending
-- outbox rows, call resolve_outbox_dispatch, POST to the WhatsApp API,
-- record the result.

-- 1. substitute_template_placeholders — the source's find/replace over
-- %FIRST_NAME%/%ORDER_DETAILS%/%CURRENT_OPEN_BUSINESS_DAY%/%NL%
-- (alerts-and-alert-templates.md's `main alert` entity). Pure and
-- immutable — no table reads, so it's trivially unit-testable and safe to
-- call per-recipient in a loop.
create or replace function public.substitute_template_placeholders(
  p_content text,
  p_first_name text,
  p_order_details text,
  p_trade_date text
)
returns text
language sql
immutable
as $$
  select replace(
    replace(
      replace(
        replace(p_content, '%FIRST_NAME%', coalesce(p_first_name, '')),
        '%ORDER_DETAILS%', coalesce(p_order_details, '')
      ),
      '%CURRENT_OPEN_BUSINESS_DAY%', coalesce(p_trade_date, '')
    ),
    '%NL%', chr(10)
  )
$$;

comment on function public.substitute_template_placeholders(text, text, text, text) is
  'Pure %TOKEN% find/replace over a notification_templates.content string. No side effects, no table reads — the whole point is to be trivially testable independent of resolve_outbox_dispatch''s recipient-routing logic.';

-- 2. create_alert — the general "write one in-app delivery record"
-- entry point any backoffice-triggered flow can call. SECURITY DEFINER
-- because writing an alert FOR another user is the entire point (Alerts'
-- own RLS, 0023, only ever lets a user read/mark-read their OWN rows);
-- scoped to backoffice callers for now since close_arrangement (backoffice-
-- only itself) is the only real caller today — broadening this to other
-- roles is a real decision for whenever a concrete non-backoffice-
-- triggered notification actually exists, not a speculative default.
create or replace function public.create_alert(
  p_intended_for_user_id uuid,
  p_alert_type_id uuid,
  p_display_record_id uuid default null,
  p_number_for_display numeric default null,
  p_full_name_for_display text default null,
  p_send_as_whatsapp boolean default null,
  p_send_as_notification boolean default null
)
returns public.alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert_type public.alert_types;
  v_alert public.alerts;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_alert_type from public.alert_types where id = p_alert_type_id;
  if not found then
    raise exception 'NOT_FOUND: alert type % does not exist', p_alert_type_id using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.profiles where user_id = p_intended_for_user_id) then
    raise exception 'NOT_FOUND: user % does not exist', p_intended_for_user_id using errcode = 'P0002';
  end if;

  insert into public.alerts (
    intended_for_user_id, alert_type_id, display_record_id,
    number_for_display, full_name_for_display, send_as_whatsapp, send_as_notification
  )
  values (
    p_intended_for_user_id, p_alert_type_id, p_display_record_id,
    p_number_for_display, p_full_name_for_display,
    coalesce(p_send_as_whatsapp, v_alert_type.send_as_whatsapp_default),
    coalesce(p_send_as_notification, v_alert_type.send_as_notification_default)
  )
  returning * into v_alert;

  return v_alert;
end;
$$;

comment on function public.create_alert(uuid, uuid, uuid, numeric, text, boolean, boolean) is
  'Backoffice-only, SECURITY DEFINER. Writes one Alerts delivery-log row for p_intended_for_user_id. send_as_whatsapp/send_as_notification default to the alert_type''s own defaults when not explicitly overridden. Raises P0002 if the alert type or the target user does not exist.';

grant execute on function public.create_alert(uuid, uuid, uuid, numeric, text, boolean, boolean) to authenticated;

-- 3. build_arrangement_alerts — the in-app counterpart of
-- build_notification_outbox: one Alerts row per individual grower/customer
-- USER (never a company or a WhatsApp group — read/unread state is
-- inherently per-recipient, so there is no "company batch" here the way
-- there is for WhatsApp). Deliberately NOT gated by the WhatsApp toggles:
-- send_as_notification is independent of send_as_whatsapp on both Alert
-- Types and Alerts (see docs/SCHEMA_DECISIONS.md) — a user should see
-- their in-app alert regardless of whether outbound WhatsApp is globally
-- enabled.
create or replace function public.build_arrangement_alerts(p_trading_day_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_customer_count integer;
  v_grower_count integer;
  v_customer_alert_type_id constant uuid := '00000000-0000-0000-0000-000000000001';
  v_grower_alert_type_id constant uuid := '00000000-0000-0000-0000-000000000002';
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  insert into public.alerts (
    intended_for_user_id, alert_type_id, display_record_id,
    number_for_display, send_as_whatsapp, send_as_notification
  )
  select
    p.user_id, v_customer_alert_type_id, p_trading_day_id,
    totals.pallets, at.send_as_whatsapp_default, at.send_as_notification_default
  from (
    select ar.customer_company_id, sum(ar.quantity_pallets) as pallets
    from public.arrangement_records ar
    join public.daily_order_products dop on dop.id = ar.daily_order_product_id
    join public.daily_orders do2 on do2.id = dop.daily_order_id
    where do2.trading_day_id = p_trading_day_id
      and ar.quantity_pallets > 0
      and do2.status <> 'open'
    group by ar.customer_company_id
  ) totals
  join public.profiles p on p.company_id = totals.customer_company_id
  cross join public.alert_types at
  where at.id = v_customer_alert_type_id;
  get diagnostics v_customer_count = row_count;

  insert into public.alerts (
    intended_for_user_id, alert_type_id, display_record_id,
    number_for_display, send_as_whatsapp, send_as_notification
  )
  select
    p.user_id, v_grower_alert_type_id, p_trading_day_id,
    totals.pallets, at.send_as_whatsapp_default, at.send_as_notification_default
  from (
    select dp.grower_company_id, sum(ar.quantity_pallets) as pallets
    from public.arrangement_records ar
    join public.daily_pick_products dpp on dpp.id = ar.daily_pick_product_id
    join public.daily_picks dp on dp.id = dpp.daily_pick_id
    where dp.trading_day_id = p_trading_day_id
      and ar.quantity_pallets > 0
    group by dp.grower_company_id
  ) totals
  join public.profiles p on p.company_id = totals.grower_company_id
  cross join public.alert_types at
  where at.id = v_grower_alert_type_id;
  get diagnostics v_grower_count = row_count;

  return v_customer_count + v_grower_count;
end;
$$;

comment on function public.build_arrangement_alerts(uuid) is
  'Backoffice-only. Writes one Alerts row per individual grower/customer user with arranged pallets for this trading day — every user in an eligible company, not just group-chat-less ones (Alerts have no group-vs-individual concept). Not gated by the WhatsApp toggles. Returns the number of rows written.';

grant execute on function public.build_arrangement_alerts(uuid) to authenticated;

-- 4. build_notification_outbox, extended: tag each row with the
-- template_key resolve_outbox_dispatch needs. Same two insert statements
-- as 0022, template_key added as a literal per batch.
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

  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  select
    p_trading_day_id, 'customer', ar.customer_company_id, 'close_arrangement_customer',
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

  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  select
    p_trading_day_id, 'grower', dp.grower_company_id, 'close_arrangement_grower',
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
  'Backoffice-only. Writes one notification_outbox row per grower/customer company with arranged pallets for this trading day, tagged with the template_key resolve_outbox_dispatch uses to compose the WhatsApp message — a durable, transactional stand-in for the source''s synchronous WhatsApp dispatch. Returns the number of rows written.';

-- 5. resolve_outbox_dispatch — the actual message-composition and
-- recipient-routing logic (close-arrangement-phase-4-terminal.md actions
-- 7/8: group batch vs individual-phone batch). SECURITY INVOKER: the
-- production caller is the drain Edge Function's service-role client
-- (bypasses RLS regardless), and a backoffice-authenticated session can
-- call it directly too (already has read access to every table this
-- touches — see auth module's "backoffice CAN read another user's
-- profile"), which is what makes this testable via the same vitest+
-- real-database pattern as every other function in this project, no Deno
-- runtime required.
create or replace function public.resolve_outbox_dispatch(p_outbox_id uuid)
returns table(target text, message text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.notification_outbox;
  v_template public.notification_templates;
  v_company public.companies;
  v_order_details text;
  v_trade_date text;
  v_body text;
begin
  select * into v_row from public.notification_outbox where id = p_outbox_id;
  if not found then
    raise exception 'NOT_FOUND: notification_outbox row % does not exist', p_outbox_id using errcode = 'P0002';
  end if;

  select * into v_template from public.notification_templates where template_key = v_row.template_key;
  if not found then
    raise exception 'NOT_FOUND: notification template % does not exist', v_row.template_key using errcode = 'P0002';
  end if;

  select * into v_company from public.companies where id = v_row.recipient_company_id;
  v_trade_date := coalesce(v_row.payload ->> 'tradeDate', '');

  select string_agg(
    format(
      '%s — %s%s: %s משטחים (%s)',
      line ->> 'familyName',
      line ->> 'varietyName',
      case when line ->> 'price' is not null then format(' — ₪%s', line ->> 'price') else '' end,
      line ->> 'quantityPallets',
      coalesce(line ->> 'growerCompanyName', line ->> 'customerCompanyName')
    ),
    chr(10)
    order by line ->> 'familyName', line ->> 'varietyName'
  )
  into v_order_details
  from jsonb_array_elements(v_row.payload -> 'lines') as line;

  if v_company.whatsapp_group_id is not null and v_company.whatsapp_group_id <> '' then
    v_body := public.substitute_template_placeholders(v_template.content, v_company.name, v_order_details, v_trade_date);
    if v_template.link is not null then
      v_body := v_body || chr(10) || v_template.link;
    end if;
    return query select v_company.whatsapp_group_id, v_body;
  else
    return query
    select
      '972' || regexp_replace(p.phone_number, '^0', ''),
      public.substitute_template_placeholders(v_template.content, split_part(p.display_name, ' ', 1), v_order_details, v_trade_date)
        || case when v_template.link is not null then chr(10) || v_template.link else '' end
    from public.profiles p
    where p.company_id = v_row.recipient_company_id
      and p.phone_number is not null
      and p.phone_number <> '';
  end if;
end;
$$;

comment on function public.resolve_outbox_dispatch(uuid) is
  'Resolves one notification_outbox row into its actual send targets: one row (the WhatsApp group id) if the recipient company has whatsapp_group_id set, otherwise one row per individual user with a phone_number on file (972-prefixed, leading 0 stripped). Each message is independently composed via substitute_template_placeholders. Raises P0002 if the outbox row or its template_key does not resolve.';

grant execute on function public.resolve_outbox_dispatch(uuid) to authenticated;

-- 6. close_arrangement, extended once more: build_arrangement_alerts is
-- one more statement in the same transaction, same reasoning as 0022's
-- own extension of this function.
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

  perform public.close_out_pick_leftovers(v_day.id);
  perform public.populate_arrangement_prices(v_day.id);

  update public.daily_arrangements
  set status = 'closed', closed_at = now()
  where trading_day_id = v_day.id;

  update public.product_varieties set highlight_price_fluctuations = false
  where highlight_price_fluctuations = true;

  update public.trading_days set phase = 'closed', updated_at = now() where id = v_day.id;

  perform public.build_notification_outbox(v_day.id);
  -- R4: same reasoning as build_notification_outbox — a plain table
  -- insert, no network call, so it's safe inside this transaction.
  perform public.build_arrangement_alerts(v_day.id);

  insert into public.lifecycle_sessions (trading_day_id, session_type, performed_by, metadata)
  values (v_day.id, 'end_the_day', (select auth.uid()), jsonb_build_object('draftPicksForceClosed', v_draft_picks))
  returning * into v_session;

  return v_session;
end;
$$;

comment on function public.close_arrangement() is
  'Backoffice-only. Phase 4 (terminal), one transaction: mass-closes every Daily Pick, computes end-of-day leftovers, populates arrangement prices, closes the arrangement, clears price-fluctuation highlights, closes the trading day, writes the notification outbox, writes in-app alerts, and logs an end_the_day session — all in the same function call, so a failure at any step rolls back every step before it. Raises P0007 if the day is not in phase "shop_closed", or if any arrangement record can''t be priced.';
