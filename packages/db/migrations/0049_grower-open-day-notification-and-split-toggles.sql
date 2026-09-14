-- Two independent additions, both from the same settings-screen redesign
-- (5 toggles instead of 2):
--
-- 1. A wholly new outbound message: growers get notified the moment a
--    business day opens, instead of only ever hearing from the platform via
--    a manually-clicked reminder bell (send_pick_reminder) or the
--    end-of-day close-arrangement summary. Text supplied directly by the
--    product owner, not invented here.
--
-- 2. close_arrangement_whatsapp_enabled split into a customer-specific and
--    a grower-specific toggle — previously one combined boolean gated both
--    audiences together; the redesigned settings screen shows them as two
--    independent switches.

-- notification_templates row for the new grower message. %FIRST_NAME% (not
-- the %NAME% the request used) — %FIRST_NAME% is the only "who is this for"
-- placeholder substitute_template_placeholders (migration 0024) actually
-- supports, and it's exactly what the request meant.
insert into public.notification_templates (template_key, channel, title, content, link) values
  (
    'business_day_open_grower',
    'whatsapp',
    'יום המסחר נפתח',
    'שלום %FIRST_NAME%. אנא עדכנו הערכת קטיף ליום %CURRENT_OPEN_BUSINESS_DAY% ',
    null
  );

-- Re-declared to add one notification_outbox row per grower, inside the
-- SAME loop that already bootstraps that grower's Daily Pick — this is
-- deliberately the identical population (active, non-empty in-season list),
-- not a second, potentially-divergent query. A plain table insert, so it
-- stays inside this function's own transaction exactly like every other
-- write here (R4): no outbound HTTP call happens until a later, separately-
-- scheduled drain picks the row up.
create or replace function public.initiate_business_day(p_trade_date date)
returns public.trading_days
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
  v_grower record;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  begin
    insert into public.trading_days (trade_date, phase, initiated_by)
    values (p_trade_date, 'initiated', (select auth.uid()))
    returning * into v_day;
  exception
    when unique_violation then
      raise exception 'DAY_ALREADY_OPEN: a trading day is already in progress — close it before initiating a new one'
        using errcode = 'P0004';
  end;

  insert into public.daily_arrangements (trading_day_id, status)
  values (v_day.id, 'open');

  for v_grower in
    select c.id
    from public.companies c
    where c.type = 'grower'
      and c.status = 'active'
      and exists (select 1 from public.grower_products gp where gp.company_id = c.id)
  loop
    perform public.bootstrap_grower_pick(v_day.id, v_grower.id);

    insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
    values (
      v_day.id, 'grower', v_grower.id, 'business_day_open_grower',
      jsonb_build_object('tradeDate', p_trade_date, 'lines', '[]'::jsonb)
    );
  end loop;

  return v_day;
end;
$$;

comment on function public.initiate_business_day(date) is
  'Backoffice-only. Phase 1: opens a new trading day, creates its Daily Arrangement, and for every active grower with a non-empty in-season list: bootstraps a Daily Pick (+ pick-product lines) via bootstrap_grower_pick, and enqueues one business_day_open_grower notification_outbox row (gated at drain time by notify_growers_on_business_day_open). Raises P0004 if a trading day is already open (Lifecycle Invariant 1 / the concurrency guard).';

-- notification_settings: three new toggles, one dropped. Existing values
-- carried forward rather than defaulting fresh — a project that already had
-- close_arrangement_whatsapp_enabled ON for both audiences combined keeps
-- both new split toggles ON, not silently reset to OFF.
alter table "public"."notification_settings"
  add column "notify_growers_on_business_day_open" boolean not null default false,
  add column "shop_open_whatsapp_enabled" boolean not null default true,
  add column "close_arrangement_customer_whatsapp_enabled" boolean not null default false,
  add column "close_arrangement_grower_whatsapp_enabled" boolean not null default false;

update "public"."notification_settings"
set
  close_arrangement_customer_whatsapp_enabled = close_arrangement_whatsapp_enabled,
  close_arrangement_grower_whatsapp_enabled = close_arrangement_whatsapp_enabled;

alter table "public"."notification_settings"
  drop column "close_arrangement_whatsapp_enabled";

comment on column "public"."notification_settings"."notify_growers_on_business_day_open" is
  'Gates the business_day_open_grower template (initiate_business_day, migration 0049). whatsapp_enabled must also be on.';

comment on column "public"."notification_settings"."shop_open_whatsapp_enabled" is
  'Gates the shop_open template (open_shop, migration 0031). whatsapp_enabled must also be on.';

comment on column "public"."notification_settings"."close_arrangement_customer_whatsapp_enabled" is
  'Gates the close_arrangement_customer template specifically — replaces the old combined close_arrangement_whatsapp_enabled (migration 0023), which gated both audiences together. whatsapp_enabled must also be on.';

comment on column "public"."notification_settings"."close_arrangement_grower_whatsapp_enabled" is
  'Gates the close_arrangement_grower template specifically — the grower half of the old combined close_arrangement_whatsapp_enabled (migration 0023). whatsapp_enabled must also be on.';
