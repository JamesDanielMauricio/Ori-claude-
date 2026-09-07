-- Makes the sidebar's "עדכון מלאי למגדלים" button unnecessary for the
-- everyday case, by doing the same reconcile automatically at the moment
-- that actually invalidates a pick list: saving a grower.
--
-- The gap this closes
-- -------------------
-- initiate_business_day bootstraps every eligible grower's Daily Pick once,
-- at day start. save_grower (0033) replaces a grower's grower_products
-- (in-season) selection and does NOT touch daily_picks at all. So editing a
-- grower's in-season list while a trading day was open left that grower's
-- pick silently stale for the rest of the day — a newly in-season variety
-- never appeared on it, and a removed one stayed. The ONLY thing that
-- reconciled that was a backoffice user remembering to press
-- update_growers_data() (0034) afterwards.
--
-- What changes
-- ------------
-- 1. The reconcile logic moves out of update_growers_data() into
--    sync_grower_picks(), which takes an optional grower id: null means
--    "every eligible grower" (the bulk path 0034 had), a uuid means "just
--    this one" (the new per-save path). ONE implementation with two entry
--    points, rather than a second copy of the same three steps that is
--    supposed to agree with the first — same rule as the catalog grouping
--    on the client and 0018's header comment on the server.
-- 2. update_growers_data() becomes a thin wrapper. Its behaviour and its
--    P0002 contract are unchanged, so the existing button keeps working as
--    a bulk/repair path.
-- 3. save_grower() calls sync_grower_picks(<that grower>) after replacing
--    grower_products, inside the same transaction — so the pick list and
--    the in-season list can never be observed disagreeing.

-- ---------------------------------------------------------------------------
-- The shared reconcile
-- ---------------------------------------------------------------------------
create or replace function public.sync_grower_picks(p_grower_company_id uuid default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
begin
  -- Backoffice-only, and the guard has to live here as well as in the
  -- callers: EXECUTE is granted to `authenticated` below (it must be —
  -- save_grower is SECURITY INVOKER, so calling this function is permission-
  -- checked against the end user, not the function owner). Without this
  -- check any signed-in grower or customer could call it directly and
  -- rewrite every grower's pick lines for the open day. It allows a
  -- backoffice user to reconcile picks; it protects every other role from
  -- being able to do so at all.
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  -- Quietly a no-op when no day is open, rather than raising: save_grower
  -- must keep working outside trading hours, and "there is nothing to sync"
  -- is the correct outcome there, not an error. update_growers_data() below
  -- does its own explicit P0002 check, so the button's contract is
  -- unaffected by this being lenient.
  --
  -- FOR UPDATE locks the open day's row for the rest of the transaction.
  -- That serialises this reconcile against a concurrent phase transition
  -- (close_shop / close_arrangement), which is the point: syncing lines
  -- against a day that is being closed underneath us would resurrect lines
  -- the close just finalised. It also serialises concurrent grower saves
  -- against each other — acceptable at this scale (tens of growers), and
  -- the safe direction to err in.
  select * into v_day from public.trading_days where phase <> 'closed' for update;
  if not found then
    return;
  end if;

  -- Bootstrap any grower that is eligible (active, non-empty in-season
  -- list) but has no pick yet for this day — the grower that was created or
  -- reactivated after the day was initiated. Same eligibility filter as
  -- initiate_business_day.
  insert into public.daily_picks (trading_day_id, grower_company_id)
  select v_day.id, c.id
  from public.companies c
  where c.type = 'grower'
    and c.status = 'active'
    and (p_grower_company_id is null or c.id = p_grower_company_id)
    and exists (select 1 from public.grower_products gp where gp.company_id = c.id)
    and not exists (
      select 1 from public.daily_picks dp
      where dp.trading_day_id = v_day.id and dp.grower_company_id = c.id
    );

  -- Drop pick lines for varieties no longer in the grower's in-season list.
  -- A line already referenced by an arrangement record is left alone: the
  -- arrangement is a committed match between a grower's supply and a
  -- customer's order, and deleting its source line would orphan it. This is
  -- the same floor invariant update_pick_product_pallets enforces.
  delete from public.daily_pick_products dpp
  using public.daily_picks dp
  where dpp.daily_pick_id = dp.id
    and dp.trading_day_id = v_day.id
    and (p_grower_company_id is null or dp.grower_company_id = p_grower_company_id)
    and not exists (
      select 1 from public.grower_products gp
      where gp.company_id = dp.grower_company_id
        and gp.product_variety_id = dpp.product_variety_id
    )
    and not exists (
      select 1 from public.arrangement_records ar where ar.daily_pick_product_id = dpp.id
    );

  -- Add lines for newly in-season varieties. Existing lines — and the
  -- pallets_picked already typed into them — are untouched.
  insert into public.daily_pick_products (daily_pick_id, product_variety_id)
  select dp.id, gp.product_variety_id
  from public.daily_picks dp
  join public.grower_products gp on gp.company_id = dp.grower_company_id
  where dp.trading_day_id = v_day.id
    and (p_grower_company_id is null or dp.grower_company_id = p_grower_company_id)
    and not exists (
      select 1 from public.daily_pick_products dpp
      where dpp.daily_pick_id = dp.id and dpp.product_variety_id = gp.product_variety_id
    );
end;
$$;

comment on function public.sync_grower_picks(uuid) is
  'Backoffice-only. Re-syncs Daily Pick lines against the current in-season list for the open trading day: bootstraps newly-eligible growers, drops out-of-season lines (unless already arranged), adds newly in-season lines. Pass a grower company id to sync one grower, or null for all of them. No-op when no trading day is open. Does not change trading_days.phase.';

-- Granted to `authenticated` because SECURITY INVOKER callers (save_grower,
-- update_growers_data) are permission-checked as the end user. The role
-- guard inside the function body is what actually restricts it to
-- backoffice; this grant only makes the call reachable.
grant execute on function public.sync_grower_picks(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The bulk entry point, now a wrapper
-- ---------------------------------------------------------------------------
-- Signature and return type are unchanged, so `create or replace` genuinely
-- replaces the existing function rather than adding an overload (the trap
-- 0031 and 0033 document applies to *changing* an argument list, which this
-- does not).
create or replace function public.update_growers_data()
returns setof public.daily_picks
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
begin
  -- Same backoffice-only guard as before. Duplicated with the one inside
  -- sync_grower_picks deliberately: this function is a public RPC in its own
  -- right, and it should reject a non-backoffice caller before doing
  -- anything at all rather than relying on a callee to do it.
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  -- Preserved explicitly: sync_grower_picks() is a quiet no-op when no day
  -- is open, but this function's callers (the sidebar button) rely on the
  -- P0002 error to tell the user why nothing happened.
  --
  -- FOR UPDATE here as well as in the callee, matching 0034's original
  -- locking exactly: taking the lock before the existence check closes the
  -- window where the day could be closed by a concurrent transaction between
  -- this check and the reconcile. Re-locking the same row inside
  -- sync_grower_picks is a no-op — the lock is already held by this
  -- transaction.
  select * into v_day from public.trading_days where phase <> 'closed' for update;
  if not found then
    raise exception 'NOT_FOUND: no trading day is open' using errcode = 'P0002';
  end if;

  -- Explicitly typed null: an untyped NULL literal is ambiguous to function
  -- resolution the moment a second overload of this name ever exists, and
  -- that failure mode is a silent wrong-function call rather than an error.
  perform public.sync_grower_picks(null::uuid);

  return query select * from public.daily_picks where trading_day_id = v_day.id;
end;
$$;

comment on function public.update_growers_data() is
  'Backoffice-only. Bulk/repair entry point for sync_grower_picks(null): re-syncs every eligible grower''s Daily Pick against their current in-season list for the open trading day. Since 0037 save_grower does this automatically per grower, so this is no longer required in the normal flow. Raises P0002 if no trading day is open.';

grant execute on function public.update_growers_data() to authenticated;

-- ---------------------------------------------------------------------------
-- save_grower now keeps the pick list in step
-- ---------------------------------------------------------------------------
-- Identical 7-argument signature to 0033, so this replaces that function in
-- place; no drop needed and existing grants are preserved.
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
  -- Backoffice-only: reference data defines who may trade and what they may
  -- trade in, so it is writable by the distributor alone. It allows a
  -- backoffice user to create and edit grower companies; it protects growers
  -- and customers from editing their own or each other's records.
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

  -- NEW in 0037. Same transaction as the grower_products write above, so the
  -- in-season list and the day's pick lines are never observable in
  -- disagreement, and a failure here rolls the whole save back rather than
  -- leaving a half-applied change. No-op outside an open trading day.
  perform public.sync_grower_picks(v_company.id);

  return v_company;
end;
$$;

comment on function public.save_grower(uuid, text, public.company_status, time, text, uuid[], uuid) is
  'Backoffice-only. Upserts a grower company row (including its assigned transporter_company_id, id 8''s cc target) and replaces its grower_products (in-season) selection in one transaction. Since 0037 it also re-syncs that grower''s Daily Pick for the open trading day, so an in-season change takes effect immediately instead of waiting for a manual update_growers_data() run. Pass p_id = null to create. Raises P0008 if p_transporter_company_id is set but doesn''t reference a company of type transporter.';

grant execute on function public.save_grower(uuid, text, public.company_status, time, text, uuid[], uuid) to authenticated;
