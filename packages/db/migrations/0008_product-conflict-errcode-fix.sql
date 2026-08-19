-- Fixes a real bug found while testing 0007's optimistic-concurrency path
-- end to end (not just via a trusted direct connection, but through the
-- actual anon-key + signed-in-JWT path apps/web uses): `save_product`'s
-- conflict branch raised with SQLSTATE 40001 (serialization_failure) —
-- semantically reasonable-looking ("a concurrent write conflicted"), but
-- 40001 is the exact code Postgres itself uses for SERIALIZABLE
-- transaction conflicts, which the connection-pooling layer between
-- PostgREST and Postgres treats as transient and worth retrying. Every
-- retry hit the same version mismatch and got 40001 again, so the call
-- hung (tens of seconds) before finally surfacing — never actually wrong,
-- just needlessly, confusingly slow, and slow enough to look like a hang
-- in a test with a normal timeout.
--
-- Fix: use 'P0003' instead — Postgres's own PL/pgSQL "user raised
-- exception" class (P0001-P0009), the same class `save_product` and every
-- other save_* function already use for NOT_FOUND ('P0002') and FORBIDDEN
-- uses '42501' (a real, but non-retried, access-rule-violation code).
-- P0003 isn't a code Postgres or any pooler assigns special retry
-- semantics to, so the conflict now surfaces immediately, exactly once,
-- as intended.
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
          using errcode = 'P0003';
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
  'Backoffice-only. Upserts a product variety with optimistic concurrency (p_expected_version must match the current row; raises P0003 on conflict) and replaces its per-customer pallet caps wholesale. Pass p_id = null to create (version starts at 1, p_expected_version ignored). p_customer_pallet_caps is a jsonb array of {"customerCompanyId": uuid, "palletCap": integer}.';
