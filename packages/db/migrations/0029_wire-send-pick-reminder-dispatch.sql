-- Wires send_pick_reminder (0015) up to the notifications module the same
-- way send_order_reminder (0028) already is — send_pick_reminder predates
-- Prompt 9's notification_outbox and was left a stamp-only stub by
-- design at the time ("no integration exists yet"); that excuse no
-- longer applies, so this closes the asymmetry the same way 0028 closed
-- it for the customer side, using the identical pattern (lock the row,
-- check not-already-closed, stamp reminder_sent_at, insert one
-- notification_outbox row with lines: [] explicitly per the tested
-- convention from Prompt 9).
create or replace function public.send_pick_reminder(p_daily_pick_id uuid)
returns public.daily_picks
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pick public.daily_picks;
  v_trade_date date;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_pick from public.daily_picks where id = p_daily_pick_id for update;
  if not found then
    raise exception 'NOT_FOUND: pick % does not exist', p_daily_pick_id using errcode = 'P0002';
  end if;

  if v_pick.status = 'closed' then
    raise exception 'INVALID_STATE: cannot send a reminder about a closed pick' using errcode = 'P0007';
  end if;

  select trade_date into v_trade_date from public.trading_days where id = v_pick.trading_day_id;

  update public.daily_picks
  set reminder_sent_at = now()
  where id = p_daily_pick_id
  returning * into v_pick;

  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  values (
    v_pick.trading_day_id, 'grower', v_pick.grower_company_id, 'pick_reminder',
    jsonb_build_object('tradeDate', v_trade_date, 'lines', '[]'::jsonb)
  );

  return v_pick;
end;
$$;

comment on function public.send_pick_reminder(uuid) is
  'Backoffice-only. Stamps reminder_sent_at on the grower''s Daily Pick and writes one notification_outbox row (template_key ''pick_reminder'', gated at drain time by the global WhatsApp toggle only). Raises P0007 if the pick is already closed.';

-- Wording adapted from the live mainalert ids 1/2 (identical duplicate
-- rows): "שלום %FIRST_NAME%. אנא עדכנו הערכת קטיף ליום %CURRENT_OPEN_BUSINESS_DAY%".
insert into public.notification_templates (template_key, channel, title, content, link) values
  (
    'pick_reminder',
    'whatsapp',
    'תזכורת לעדכון קטיף',
    '%FIRST_NAME% שלום,%NL%אנא עדכנו הערכת קטיף ליום %CURRENT_OPEN_BUSINESS_DAY%.',
    null
  );
