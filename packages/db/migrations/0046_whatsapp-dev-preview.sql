-- Factored out of resolve_outbox_dispatch (migration 0024) so the same
-- line-item formatting isn't duplicated (and free to drift) between it and
-- resolve_outbox_preview below. Pure/immutable: only reads its own jsonb
-- argument, no table access.
create or replace function public.compose_order_details_text(p_payload jsonb)
returns text
language sql
immutable
as $$
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
  from jsonb_array_elements(p_payload -> 'lines') as line;
$$;

-- Re-declared to call the helper above instead of its own inline copy of the
-- same string_agg — behavior is unchanged, this is a pure refactor.
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
  v_order_details := public.compose_order_details_text(v_row.payload);

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

-- Dev-only companion to resolve_outbox_dispatch above, which this NEVER
-- replaces or is called instead of in live env — see whatsapp-dispatch's own
-- comment for the env split. resolve_outbox_dispatch's whole point is
-- "who can we actually reach," so a test company with nobody's phone number
-- on file correctly resolves to zero targets there — but that means dev
-- testing was structurally unable to verify "does WhatsApp work / does the
-- message read right" without first fabricating real-looking contact data on
-- test companies. This composes the exact same message body ALWAYS, using
-- the recipient company's own name in place of a personal first name (there
-- is no single "the" recipient to draw one from when previewing), so
-- whatsapp-dispatch can send it to whatsapp_dev_override_phone regardless of
-- whether anyone is really reachable. Never used for a real send — nothing
-- about resolve_outbox_dispatch's own recipient resolution changes.
create or replace function public.resolve_outbox_preview(p_outbox_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.notification_outbox;
  v_template public.notification_templates;
  v_company public.companies;
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

  v_body := public.substitute_template_placeholders(
    v_template.content,
    v_company.name,
    public.compose_order_details_text(v_row.payload),
    coalesce(v_row.payload ->> 'tradeDate', '')
  );
  if v_template.link is not null then
    v_body := v_body || chr(10) || v_template.link;
  end if;

  return v_body;
end;
$$;

comment on function public.resolve_outbox_preview(uuid) is
  'Dev-only preview companion to resolve_outbox_dispatch: composes the same message body (company name standing in for a personal first name) regardless of whether the company has any real contactable recipient. whatsapp-dispatch calls this instead of resolve_outbox_dispatch when WHATSAPP_ENV != "live", to always have something to send to whatsapp_dev_override_phone. Never used for a real/live send.';

grant execute on function public.resolve_outbox_preview(uuid) to authenticated;
