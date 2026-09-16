-- resolve_outbox_dispatch gains an is_group column so callers know which
-- Green API suffix a target needs (@g.us for a WhatsApp group, @c.us for an
-- individual) without guessing from the string's shape. Previously
-- supabase/functions/whatsapp-dispatch's toChatId inferred "this is a group"
-- from the target already containing "@" — which only worked if whoever
-- entered whatsapp_group_id in the backoffice UI had typed the "@g.us"
-- suffix themselves. That's no longer required: whatsapp_group_id is just
-- the bare group id, and is_group (set true on the whatsapp_group_id branch
-- below, false on the per-user phone branch) is what the caller now uses to
-- pick the suffix explicitly. See this migration's companion change to
-- toChatId in supabase/functions/whatsapp-dispatch/index.ts.
--
-- `create or replace function` cannot change a `returns table (...)` shape
-- (Postgres error 42P13: "cannot change return type of existing
-- function") — adding a column counts as changing it. An explicit drop is
-- required first; `if exists` makes this safe to re-run after a failed
-- attempt.
drop function if exists public.resolve_outbox_dispatch(uuid);

create function public.resolve_outbox_dispatch(p_outbox_id uuid)
returns table(target text, is_group boolean, message text)
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
  v_order_details := public.compose_order_details_text(v_row.payload);

  if v_company.whatsapp_group_id is not null and v_company.whatsapp_group_id <> '' then
    v_body := public.substitute_template_placeholders(v_template.content, v_company.name, v_order_details, v_trade_date);
    if v_template.link is not null then
      v_body := v_body || chr(10) || v_template.link;
    end if;
    return query select v_company.whatsapp_group_id, true, v_body;
  else
    return query
    select
      '972' || regexp_replace(p.phone_number, '^0', ''),
      false,
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
  'Resolves one notification_outbox row into its actual send targets: one row (the bare WhatsApp group id, is_group = true) if the recipient company has whatsapp_group_id set, otherwise one row per individual user with a phone_number on file (is_group = false, 972-prefixed, leading 0 stripped). is_group tells the caller which Green API chat-id suffix to append (@g.us vs @c.us) — whatsapp_group_id itself carries no suffix. Each message is independently composed via substitute_template_placeholders. Raises P0002 if the outbox row or its template_key does not resolve.';

grant execute on function public.resolve_outbox_dispatch(uuid) to authenticated;

-- Backfill: strip any "@g.us" already saved on an existing row. The
-- backoffice group-id field never asked for one, but under the OLD
-- toChatId's "already contains @, pass through unchanged" guess, a value
-- pasted in with the suffix already worked — so it's plausible some rows
-- have it. Left in place, the new explicit is_group suffixing above would
-- double it to "...@g.us@g.us" and silently misroute every group send for
-- that company. Green API's own suffix is always exactly "@g.us",
-- lowercase, so no case-insensitive match is needed.
update public.companies
set whatsapp_group_id = regexp_replace(whatsapp_group_id, '@g\.us$', '')
where whatsapp_group_id like '%@g.us';
