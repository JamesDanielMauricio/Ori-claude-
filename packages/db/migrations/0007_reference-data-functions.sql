-- R4 + R7, the Supabase way: every multi-field reference-data save is a
-- single plpgsql function invoked via `supabase.rpc()`, not a sequence of
-- `.update()`/`.insert()` REST calls. A function call is one statement —
-- Postgres runs its whole body as one implicit transaction, so if any step
-- raises (a bad FK, a version mismatch), everything the function did
-- rolls back together. That's what makes the source app's documented
-- failure mode ("workflow dies between step 4 and step 5, parent record
-- never gets its update") structurally impossible here, not just less
-- likely.
--
-- `security invoker` (the default, stated explicitly): each function runs
-- with the CALLING user's own privileges, so the RLS policies from
-- 0006/0003 still govern every write it performs — a function body isn't
-- a way around RLS. The explicit `current_role() <> 'backoffice'` check at
-- the top of each function is not a second, divergent source of truth: it
-- reads the exact same `current_role()` the RLS policies themselves call,
-- just surfaced as a clear, catchable error message instead of a silent
-- "0 rows matched" from an RLS-filtered UPDATE.

-- 1. save_grower — company row + its in-season product selection
--    (grower_products), replaced wholesale in one transaction.
create or replace function public.save_grower(
  p_id uuid,
  p_name text,
  p_status public.company_status,
  p_default_pickup_time time,
  p_whatsapp_group_id text,
  p_product_variety_ids uuid[]
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
    insert into public.companies (name, type, status, default_pickup_time, whatsapp_group_id)
    values (p_name, 'grower', p_status, p_default_pickup_time, p_whatsapp_group_id)
    returning * into v_company;
  else
    update public.companies
    set name = p_name,
        status = p_status,
        default_pickup_time = p_default_pickup_time,
        whatsapp_group_id = p_whatsapp_group_id,
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

comment on function public.save_grower(uuid, text, public.company_status, time, text, uuid[]) is
  'Backoffice-only. Upserts a grower company row and replaces its grower_products (in-season) selection in one transaction. Pass p_id = null to create.';

grant execute on function public.save_grower(uuid, text, public.company_status, time, text, uuid[]) to authenticated;

-- 2. save_customer — single-row save. Still an RPC (not a plain
--    `.update()`) for the same reason every screen in this module goes
--    through one: a single call site for the backoffice-only authorization
--    check, and a consistent client-side pattern across all five screens.
create or replace function public.save_customer(
  p_id uuid,
  p_name text,
  p_status public.company_status,
  p_can_see_product_prices boolean,
  p_whatsapp_group_id text
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
    insert into public.companies (name, type, status, can_see_product_prices, whatsapp_group_id)
    values (p_name, 'customer', p_status, p_can_see_product_prices, p_whatsapp_group_id)
    returning * into v_company;
  else
    update public.companies
    set name = p_name,
        status = p_status,
        can_see_product_prices = p_can_see_product_prices,
        whatsapp_group_id = p_whatsapp_group_id,
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

comment on function public.save_customer(uuid, text, public.company_status, boolean, text) is
  'Backoffice-only. Upserts a customer company row. Pass p_id = null to create.';

grant execute on function public.save_customer(uuid, text, public.company_status, boolean, text) to authenticated;

-- 3. save_transporter — same single-row shape as save_customer.
create or replace function public.save_transporter(
  p_id uuid,
  p_name text,
  p_status public.company_status,
  p_whatsapp_group_id text
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
    insert into public.companies (name, type, status, whatsapp_group_id)
    values (p_name, 'transporter', p_status, p_whatsapp_group_id)
    returning * into v_company;
  else
    update public.companies
    set name = p_name,
        status = p_status,
        whatsapp_group_id = p_whatsapp_group_id,
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

comment on function public.save_transporter(uuid, text, public.company_status, text) is
  'Backoffice-only. Upserts a transporter company row. Pass p_id = null to create.';

grant execute on function public.save_transporter(uuid, text, public.company_status, text) to authenticated;

-- 4. save_product — the conflict-prevention-critical function. The UPDATE's
--    WHERE clause checks `version = p_expected_version` and increments it
--    in the SAME statement that writes the row: a concurrent second writer
--    working off a stale version simply matches zero rows (checked via
--    FOUND), which is turned into a distinguishable 40001
--    (serialization_failure) error rather than either silently overwriting
--    the first writer's change or leaving a UI-level "someone else is
--    editing" flag for the app to manage. Also replaces the product's
--    per-customer pallet caps wholesale, in the same transaction.
create or replace function public.save_product(
  p_id uuid,
  p_family_id uuid,
  p_name text,
  p_sizes text,
  p_pack_type public.pack_type,
  p_price numeric,
  p_price_range_from numeric,
  p_price_range_to numeric,
  p_price_type text,
  p_no_overbooking numeric,
  p_highlight_price_fluctuations boolean,
  p_is_seasonal_available boolean,
  p_expected_version integer,
  p_customer_pallet_caps jsonb
)
returns public.product_varieties
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_product public.product_varieties;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.product_varieties (
      family_id, name, sizes, pack_type, price, price_range_from, price_range_to,
      price_type, no_overbooking, highlight_price_fluctuations, is_seasonal_available, version
    )
    values (
      p_family_id, p_name, p_sizes, p_pack_type, p_price, p_price_range_from, p_price_range_to,
      p_price_type, p_no_overbooking, p_highlight_price_fluctuations, p_is_seasonal_available, 1
    )
    returning * into v_product;
  else
    update public.product_varieties
    set family_id = p_family_id,
        name = p_name,
        sizes = p_sizes,
        pack_type = p_pack_type,
        price = p_price,
        price_range_from = p_price_range_from,
        price_range_to = p_price_range_to,
        price_type = p_price_type,
        no_overbooking = p_no_overbooking,
        highlight_price_fluctuations = p_highlight_price_fluctuations,
        is_seasonal_available = p_is_seasonal_available,
        version = version + 1,
        updated_at = now()
    where id = p_id and version = p_expected_version
    returning * into v_product;

    if not found then
      if exists (select 1 from public.product_varieties where id = p_id) then
        raise exception
          'CONFLICT: product % was modified by someone else since it was loaded (expected version %)',
          p_id, p_expected_version
          using errcode = '40001';
      else
        raise exception 'NOT_FOUND: product % does not exist', p_id using errcode = 'P0002';
      end if;
    end if;
  end if;

  with incoming as (
    select (elem ->> 'customerCompanyId')::uuid as customer_company_id,
           (elem ->> 'palletCap')::integer as pallet_cap
    from jsonb_array_elements(p_customer_pallet_caps) as elem
  )
  delete from public.product_customer_caps pcc
  where pcc.product_variety_id = v_product.id
    and not exists (
      select 1 from incoming i where i.customer_company_id = pcc.customer_company_id
    );

  insert into public.product_customer_caps (product_variety_id, customer_company_id, pallet_cap)
  select v_product.id, (elem ->> 'customerCompanyId')::uuid, (elem ->> 'palletCap')::integer
  from jsonb_array_elements(p_customer_pallet_caps) as elem
  on conflict (product_variety_id, customer_company_id)
    do update set pallet_cap = excluded.pallet_cap, updated_at = now();

  return v_product;
end;
$$;

comment on function public.save_product(
  uuid, uuid, text, text, public.pack_type, numeric, numeric, numeric, text, numeric,
  boolean, boolean, integer, jsonb
) is
  'Backoffice-only. Upserts a product variety with optimistic concurrency (p_expected_version must match the current row; raises 40001 on conflict) and replaces its per-customer pallet caps wholesale. Pass p_id = null to create (version starts at 1, p_expected_version ignored). p_customer_pallet_caps is a jsonb array of {"customerCompanyId": uuid, "palletCap": integer}.';

grant execute on function public.save_product(
  uuid, uuid, text, text, public.pack_type, numeric, numeric, numeric, text, numeric,
  boolean, boolean, integer, jsonb
) to authenticated;

-- 5. save_user — profile fields + the per-user product blacklist,
--    replaced wholesale in one transaction. No create path: account
--    creation stays the existing service-role bulk-import flow (a
--    profiles row with no matching auth.users identity would be an
--    orphan), so p_user_id must reference an existing profile.
create or replace function public.save_user(
  p_user_id uuid,
  p_display_name text,
  p_role public.user_role,
  p_company_id uuid,
  p_blocked_product_variety_ids uuid[]
)
returns public.profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  update public.profiles
  set display_name = p_display_name,
      role = p_role,
      company_id = p_company_id,
      updated_at = now()
  where user_id = p_user_id
  returning * into v_profile;

  if not found then
    raise exception 'NOT_FOUND: user % does not exist', p_user_id using errcode = 'P0002';
  end if;

  delete from public.profile_blocked_products
  where user_id = v_profile.user_id
    and not (product_variety_id = any(coalesce(p_blocked_product_variety_ids, array[]::uuid[])));

  insert into public.profile_blocked_products (user_id, product_variety_id)
  select v_profile.user_id, pv_id
  from unnest(coalesce(p_blocked_product_variety_ids, array[]::uuid[])) as pv_id
  on conflict (user_id, product_variety_id) do nothing;

  return v_profile;
end;
$$;

comment on function public.save_user(uuid, text, public.user_role, uuid, uuid[]) is
  'Backoffice-only. Updates an existing user''s profile fields and replaces their product blacklist (profile_blocked_products) in one transaction.';

grant execute on function public.save_user(uuid, text, public.user_role, uuid, uuid[]) to authenticated;
