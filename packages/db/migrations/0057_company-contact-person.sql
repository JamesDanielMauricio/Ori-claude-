-- A "contact person" for a company: one profile (a real signed-in user)
-- the distributor treats as who to reach for that grower/customer/
-- transporter. Not a new PRD field — the Bubble source has no equivalent —
-- this is a genuinely new column, requested directly rather than migrated.
--
-- Deliberately NOT scoped to "one of this company's own users": a
-- Transporter company never has any profiles of its own (see
-- packages/db/src/schema/enums.ts's user_role comment — transporters never
-- sign in, so they never get a profiles row at all). Scoping the picker to
-- "this company's users" would make a transporter's contact person
-- unsettable forever. So contact_person_id may point at ANY profile in the
-- system, same as the existing "select any transporter" pattern
-- (transporter_company_id, 0033) already does across company boundaries.
--
-- `on delete set null`, not the default RESTRICT `transporter_company_id`
-- uses: deleting a USER (which cascades profiles -> auth.users, see
-- profile.ts) is a routine admin action (users.tsx's delete button) that
-- must not be blocked just because that person was once marked as some
-- company's contact — the field simply goes back to unset.
alter table public.companies
  add column contact_person_id uuid references public.profiles(user_id) on delete set null;

comment on column public.companies.contact_person_id is
  'The profile (any user in the system, not necessarily one belonging to this company) the distributor treats as this company''s point of contact. Nullable — most companies have none set. Set null automatically if that user''s account is deleted.';

-- ---------------------------------------------------------------------------
-- save_grower — add p_contact_person_id as a new 8th parameter
-- ---------------------------------------------------------------------------
-- Adding a parameter via `create or replace` does NOT replace a function
-- whose argument list doesn't match exactly — it silently creates a dead,
-- unreachable second overload instead (the exact mistake 0031 found and
-- 0033/0037 already had to work around). Dropped explicitly so that doesn't
-- happen again.
drop function if exists public.save_grower(uuid, text, public.company_status, time, text, uuid[], uuid);

create or replace function public.save_grower(
  p_id uuid,
  p_name text,
  p_status public.company_status,
  p_default_pickup_time time,
  p_whatsapp_group_id text,
  p_product_variety_ids uuid[],
  p_transporter_company_id uuid default null,
  p_contact_person_id uuid default null
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
    insert into public.companies (
      name, type, status, default_pickup_time, whatsapp_group_id, transporter_company_id, contact_person_id
    )
    values (
      p_name, 'grower', p_status, p_default_pickup_time, p_whatsapp_group_id, p_transporter_company_id, p_contact_person_id
    )
    returning * into v_company;
  else
    update public.companies
    set name = p_name,
        status = p_status,
        default_pickup_time = p_default_pickup_time,
        whatsapp_group_id = p_whatsapp_group_id,
        transporter_company_id = p_transporter_company_id,
        contact_person_id = p_contact_person_id,
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

  perform public.sync_grower_picks(v_company.id);

  return v_company;
end;
$$;

comment on function public.save_grower(uuid, text, public.company_status, time, text, uuid[], uuid, uuid) is
  'Backoffice-only. Upserts a grower company row (including its assigned transporter_company_id, id 8''s cc target, and its contact_person_id) and replaces its grower_products (in-season) selection in one transaction. Re-syncs that grower''s Daily Pick for the open trading day (0037). Pass p_id = null to create. Raises P0008 if p_transporter_company_id is set but doesn''t reference a company of type transporter.';

grant execute on function public.save_grower(uuid, text, public.company_status, time, text, uuid[], uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- save_customer — add p_contact_person_id as a new 6th parameter
-- ---------------------------------------------------------------------------
drop function if exists public.save_customer(uuid, text, public.company_status, boolean, text);

create or replace function public.save_customer(
  p_id uuid,
  p_name text,
  p_status public.company_status,
  p_can_see_product_prices boolean,
  p_whatsapp_group_id text,
  p_contact_person_id uuid default null
)
returns public.companies
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company public.companies;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.companies (name, type, status, can_see_product_prices, whatsapp_group_id, contact_person_id)
    values (p_name, 'customer', p_status, p_can_see_product_prices, p_whatsapp_group_id, p_contact_person_id)
    returning * into v_company;
  else
    update public.companies
    set name = p_name,
        status = p_status,
        can_see_product_prices = p_can_see_product_prices,
        whatsapp_group_id = p_whatsapp_group_id,
        contact_person_id = p_contact_person_id,
        updated_at = now()
    where id = p_id and type = 'customer'
    returning * into v_company;

    if not found then
      raise exception 'NOT_FOUND: customer company % does not exist', p_id using errcode = 'P0002';
    end if;
  end if;

  return v_company;
end;
$$;

comment on function public.save_customer(uuid, text, public.company_status, boolean, text, uuid) is
  'Backoffice-only. Upserts a customer company row, including its contact_person_id. Pass p_id = null to create.';

grant execute on function public.save_customer(uuid, text, public.company_status, boolean, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- save_transporter — add p_contact_person_id as a new 5th parameter
-- ---------------------------------------------------------------------------
drop function if exists public.save_transporter(uuid, text, public.company_status, text);

create or replace function public.save_transporter(
  p_id uuid,
  p_name text,
  p_status public.company_status,
  p_whatsapp_group_id text,
  p_contact_person_id uuid default null
)
returns public.companies
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company public.companies;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.companies (name, type, status, whatsapp_group_id, contact_person_id)
    values (p_name, 'transporter', p_status, p_whatsapp_group_id, p_contact_person_id)
    returning * into v_company;
  else
    update public.companies
    set name = p_name,
        status = p_status,
        whatsapp_group_id = p_whatsapp_group_id,
        contact_person_id = p_contact_person_id,
        updated_at = now()
    where id = p_id and type = 'transporter'
    returning * into v_company;

    if not found then
      raise exception 'NOT_FOUND: transporter company % does not exist', p_id using errcode = 'P0002';
    end if;
  end if;

  return v_company;
end;
$$;

comment on function public.save_transporter(uuid, text, public.company_status, text, uuid) is
  'Backoffice-only. Upserts a transporter company row, including its contact_person_id. Pass p_id = null to create.';

grant execute on function public.save_transporter(uuid, text, public.company_status, text, uuid) to authenticated;
