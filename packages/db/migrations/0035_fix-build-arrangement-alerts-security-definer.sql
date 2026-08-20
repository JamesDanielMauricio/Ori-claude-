-- build_arrangement_alerts (0024) inserts directly into public.alerts, but
-- was declared security invoker — so it ran as the calling (authenticated)
-- role, which only ever has select/update on alerts (0023), never insert.
-- Every call failed with "permission denied for table alerts", which
-- rolled back close_arrangement()'s whole transaction. Flipping to security
-- definer matches create_alert's already-established pattern (0024): the
-- function keeps its own current_role() = 'backoffice' check, so this only
-- lets that check run with the privileges it always assumed it had.
create or replace function public.build_arrangement_alerts(p_trading_day_id uuid)
returns integer
language plpgsql
security definer
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
  'Backoffice-only, SECURITY DEFINER. Writes one Alerts row per individual grower/customer user with arranged pallets for this trading day — every user in an eligible company, not just group-chat-less ones (Alerts have no group-vs-individual concept). Not gated by the WhatsApp toggles. Returns the number of rows written.';
