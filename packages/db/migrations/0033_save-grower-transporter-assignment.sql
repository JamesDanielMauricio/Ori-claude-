-- Lets the distributor actually populate companies.transporter_company_id
-- (added 0031 for id 8's arrangement-finalization cc) — until now nothing
-- in the app could set it; the only place that ever wrote it was a test
-- fixture. The Growers screen is where it belongs (grower-only in
-- practice), through the same save_grower RPC every other field on that
-- screen already goes through (R4 — one transactional call, not a second
-- write path).
--
-- Adding a parameter to an existing function signature via `create or
-- replace` does NOT replace it if the argument list doesn't match
-- exactly — it silently creates a dead, unreachable second overload
-- instead (the exact mistake 0031 found and fixed for three other
-- functions). Dropped explicitly here so that doesn't happen again.
drop function if exists public.save_grower(uuid, text, public.company_status, time, text, uuid[]);

create or replace function public.save_grower(
  p_id uuid,
  p_name text,
  p_status public.company_status,
  p_default_pickup_time time,
  p_whatsapp_group_id text,
  p_product_variety_ids uuid[],
  p_transporter_company_id uuid default null
)
returns public.companies
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company public.companies;
  v_transporter_type public.company_type;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  if p_transporter_company_id is not null then
    select type into v_transporter_type from public.companies where id = p_transporter_company_id;
    if not found or v_transporter_type <> 'transporter' then
      raise exception 'INVALID_INPUT: % is not a transporter company', p_transporter_company_id using errcode = 'P0008';
    end if;
  end if;

  if p_id is null then
    insert into public.companies (name, type, status, default_pickup_time, whatsapp_group_id, transporter_company_id)
    values (p_name, 'grower', p_status, p_default_pickup_time, p_whatsapp_group_id, p_transporter_company_id)
    returning * into v_company;
  else
    update public.companies
    set name = p_name,
        status = p_status,
        default_pickup_time = p_default_pickup_time,
        whatsapp_group_id = p_whatsapp_group_id,
        transporter_company_id = p_transporter_company_id,
        updated_at = now()
    where id = p_id and type = 'grower'
    returning * into v_company;

    if not found then
      raise exception 'NOT_FOUND: grower company % does not exist', p_id using errcode = 'P0002';
    end if;
  end if;

  delete from public.grower_products
  where company_id = v_company.id
    and not (product_variety_id = any(coalesce(p_product_variety_ids, array[]::uuid[])));

  insert into public.grower_products (company_id, product_variety_id)
  select v_company.id, pv_id
  from unnest(coalesce(p_product_variety_ids, array[]::uuid[])) as pv_id
  on conflict (company_id, product_variety_id) do nothing;

  return v_company;
end;
$$;

comment on function public.save_grower(uuid, text, public.company_status, time, text, uuid[], uuid) is
  'Backoffice-only. Upserts a grower company row (including its assigned transporter_company_id, id 8''s cc target) and replaces its grower_products (in-season) selection in one transaction. Pass p_id = null to create. Raises P0008 if p_transporter_company_id is set but doesn''t reference a company of type transporter.';

grant execute on function public.save_grower(uuid, text, public.company_status, time, text, uuid[], uuid) to authenticated;
