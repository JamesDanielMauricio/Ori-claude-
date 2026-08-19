-- The six remaining mainalert triggers (ids 3, 4, 6, 8, 10, 11 —
-- docs/DATA_MIGRATION_PLAN.md § 3b), all through the existing
-- NotificationService/outbox pattern (Prompt 9) — no new dispatch
-- mechanism. R5: every state-crossing check happens inside the write-path
-- function that could have caused it, computed synchronously in the same
-- transaction — never a trigger watching for the change after the fact.

-- 0. companies.transporter_company_id — needed for id 8 (cc the
-- transporter on arrangement finalization). See company.ts's own comment
-- for why this wasn't already here.
alter table "public"."companies" add column "transporter_company_id" uuid references "public"."companies"("id");

-- 0b. Housekeeping, found while extending substitute_template_placeholders
-- below: `create or replace function` only replaces a function whose
-- argument list matches exactly — adding parameters (even with defaults)
-- creates a second, dead OVERLOAD instead of actually replacing the old
-- one. That happened silently in 0028 (get_orderable_catalog_for_customer
-- and submit_order both still have their original, now-unreachable
-- 1-arg/2-arg signatures sitting in the schema — confirmed via
-- pg_get_function_identity_arguments). Dropped here rather than left as
-- clutter; every real caller already always supplies the newer signature
-- (toOrderableCatalogRpcArgs/toSubmitOrderRpcArgs both always include
-- p_customer_company_id, even as null), so nothing depends on the old
-- ones. substitute_template_placeholders is dropped pre-emptively for the
-- same reason, immediately below, before its own extension.
drop function if exists public.get_orderable_catalog_for_customer(uuid);
drop function if exists public.submit_order(uuid, jsonb);
drop function if exists public.substitute_template_placeholders(text, text, text, text);

-- 1. substitute_template_placeholders, extended with three more optional
-- tokens. %COMPANY% is genuinely new semantics, not a rename of
-- %FIRST_NAME%: %FIRST_NAME% is who the message is greeting (the
-- recipient — an individual's first name, or the recipient company's own
-- name for a group dispatch, per resolve_outbox_dispatch's existing
-- substitution); %COMPANY% is a THIRD PARTY the message is ABOUT (e.g.
-- "the grower who just updated their pick" when the recipient is
-- backoffice) — the two are never interchangeable, and ids 3/6 both need
-- a third-party company name distinct from the recipient's own identity.
-- %PRODUCT_NAME%/%PRODUCT_OVERBOOKING% are similarly new, needed only by
-- ids 10/11. All three default to null/'' so every existing call site
-- (close_arrangement_customer/grower, order_reminder, pick_reminder) is
-- unaffected — replace() on a token that isn't in the content is a no-op.
create or replace function public.substitute_template_placeholders(
  p_content text,
  p_first_name text,
  p_order_details text,
  p_trade_date text,
  p_company_name text default null,
  p_product_name text default null,
  p_product_overbooking text default null
)
returns text
language sql
immutable
as $$
  select replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(p_content, '%FIRST_NAME%', coalesce(p_first_name, '')),
              '%ORDER_DETAILS%', coalesce(p_order_details, '')
            ),
            '%CURRENT_OPEN_BUSINESS_DAY%', coalesce(p_trade_date, '')
          ),
          '%COMPANY%', coalesce(p_company_name, '')
        ),
        '%PRODUCT_NAME%', coalesce(p_product_name, '')
      ),
      '%PRODUCT_OVERBOOKING%', coalesce(p_product_overbooking, '')
    ),
    '%NL%', chr(10)
  )
$$;

comment on function public.substitute_template_placeholders(text, text, text, text, text, text, text) is
  'Pure %TOKEN% find/replace over a notification_templates.content string. %FIRST_NAME% is the recipient''s own identity (individual first name, or recipient company name for a group dispatch); %COMPANY% is a third party the message is ABOUT, never the recipient — the two are never interchangeable. No side effects, no table reads.';

-- 2. resolve_outbox_dispatch, extended to read+pass the three new tokens
-- through from the outbox row's own payload — same pattern tradeDate
-- already uses (payload ->> 'key', coalesced to null when a template
-- doesn't need it).
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
  v_company_name text;
  v_product_name text;
  v_product_overbooking text;
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
  v_company_name := v_row.payload ->> 'companyName';
  v_product_name := v_row.payload ->> 'productName';
  v_product_overbooking := v_row.payload ->> 'productOverbooking';

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
  into v_order_details
  from jsonb_array_elements(v_row.payload -> 'lines') as line;

  if v_company.whatsapp_group_id is not null and v_company.whatsapp_group_id <> '' then
    v_body := public.substitute_template_placeholders(
      v_template.content, v_company.name, v_order_details, v_trade_date,
      v_company_name, v_product_name, v_product_overbooking
    );
    if v_template.link is not null then
      v_body := v_body || chr(10) || v_template.link;
    end if;
    return query select v_company.whatsapp_group_id, v_body;
  else
    return query
    select
      '972' || regexp_replace(p.phone_number, '^0', ''),
      public.substitute_template_placeholders(
        v_template.content, split_part(p.display_name, ' ', 1), v_order_details, v_trade_date,
        v_company_name, v_product_name, v_product_overbooking
      )
        || case when v_template.link is not null then chr(10) || v_template.link else '' end
    from public.profiles p
    where p.company_id = v_row.recipient_company_id
      and p.phone_number is not null
      and p.phone_number <> '';
  end if;
end;
$$;

comment on function public.resolve_outbox_dispatch(uuid) is
  'Resolves one notification_outbox row into its actual send targets: one row (the WhatsApp group id) if the recipient company has whatsapp_group_id set, otherwise one row per individual user with a phone_number on file (972-prefixed, leading 0 stripped). Each message is independently composed via substitute_template_placeholders, including the companyName/productName/productOverbooking payload keys ids 3/6/10/11 use. Raises P0002 if the outbox row or its template_key does not resolve.';

-- 3. enqueue_backoffice_notification — the one pattern every
-- backoffice-addressed trigger (ids 3, 6, 10, 11) reuses, rather than
-- four separate ad-hoc "who counts as backoffice" queries. Backoffice is
-- a role, not a single company (nothing in this schema enforces exactly
-- one backoffice-typed company), so "notify backoffice" means "one
-- outbox row per active backoffice company" — the same "one row per
-- company" shape build_notification_outbox already uses for
-- growers/customers, just applied to company type 'backoffice'.
--
-- Deliberately NOT granted to `authenticated` — this is an internal
-- helper only ever called from within another SECURITY DEFINER function
-- (submit_order, update_pick_product_pallets), never a direct client RPC
-- target. Granting it broadly would let any authenticated caller enqueue
-- an arbitrary template_key/payload addressed to backoffice — a real
-- spoofing surface for no legitimate reason, given no client-facing
-- screen ever needs to call this directly. The internal call still
-- succeeds without a grant: it runs under its callers' already-elevated
-- (security definer) execution context, the same bypass
-- order_submission_logs already relies on for its own no-INSERT-policy
-- table (see docs/SCHEMA_DECISIONS.md).
create or replace function public.enqueue_backoffice_notification(
  p_trading_day_id uuid,
  p_template_key text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  select p_trading_day_id, 'backoffice', c.id, p_template_key, p_payload
  from public.companies c
  where c.type = 'backoffice' and c.status = 'active';
end;
$$;

comment on function public.enqueue_backoffice_notification(uuid, text, jsonb) is
  'Internal only (no grant to authenticated) — enqueues one notification_outbox row per active backoffice-typed company. The one reusable pattern for every backoffice-addressed trigger (pick_updated, order_submitted, stock_overbooking_reached, stock_fully_exhausted) rather than four independent queries.';

-- 4. open_shop, extended: id 4 — announce the shop is open to every
-- active customer, in the same transaction as the phase change (R5), same
-- "one row per company" INSERT...SELECT shape the daily_orders bootstrap
-- immediately above it already uses — not a loop, not a separate helper
-- (this is the only place this particular fan-out is needed).
create or replace function public.open_shop(p_can_see_prices boolean default true)
returns public.daily_shops
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day public.trading_days;
  v_shop public.daily_shops;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select * into v_day from public.trading_days where phase <> 'closed' for update;
  if not found then
    raise exception 'NOT_FOUND: no trading day is open' using errcode = 'P0002';
  end if;
  if v_day.phase <> 'initiated' then
    raise exception 'INVALID_STATE: cannot open shop — trading day is in phase %, expected initiated', v_day.phase
      using errcode = 'P0007';
  end if;

  begin
    insert into public.daily_shops (trading_day_id, can_see_prices, opened_by)
    values (v_day.id, p_can_see_prices, (select auth.uid()))
    returning * into v_shop;
  exception
    when unique_violation then
      raise exception 'SHOP_ALREADY_OPEN: this trading day already has a shop' using errcode = 'P0005';
  end;

  update public.trading_days set phase = 'shop_open', updated_at = now() where id = v_day.id;

  -- Bootstrap: one daily_order header per active customer.
  insert into public.daily_orders (trading_day_id, customer_company_id)
  select v_day.id, c.id
  from public.companies c
  where c.type = 'customer'
    and c.status = 'active';

  -- id 4: one shop_open outbox row per active customer, same set the
  -- daily_orders bootstrap immediately above just created a header for.
  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  select v_day.id, 'customer', c.id, 'shop_open', jsonb_build_object('tradeDate', v_day.trade_date, 'lines', '[]'::jsonb)
  from public.companies c
  where c.type = 'customer'
    and c.status = 'active';

  return v_shop;
end;
$$;

comment on function public.open_shop(boolean) is
  'Backoffice-only. Phase 2: opens the day''s shop, bootstraps a Daily Order header for every active customer, and enqueues one shop_open notification_outbox row per active customer (id 4). Raises P0007 if the day is not in phase "initiated", P0005 on a concurrent double-open.';

-- 5. update_pick_product_pallets, extended: id 3 — when the GROWER
-- themselves updates their own pick estimate (not when backoffice edits
-- it on the grower's behalf via distributor-grower — notifying backoffice
-- about backoffice's own action would be pointless self-notification),
-- enqueue one pick_updated alert to backoffice via
-- enqueue_backoffice_notification. Fires on every such edit, matching the
-- source's own (undocumented-in-PRD, confirmed-live) behavior — not
-- throttled; if that proves noisy in practice, rate-limiting is a
-- separate, deliberate follow-up decision, not something to guess at here.
create or replace function public.update_pick_product_pallets(
  p_daily_pick_product_id uuid,
  p_pallets_picked numeric
)
returns public.daily_pick_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.daily_pick_products;
  v_grower_company_id uuid;
  v_grower_company_name text;
  v_pick_status public.daily_pick_status;
  v_trading_day_id uuid;
  v_trade_date date;
  v_arranged numeric;
  v_is_grower_initiated boolean;
begin
  if p_pallets_picked < 0 then
    raise exception 'INVALID_INPUT: pallets picked cannot be negative' using errcode = 'P0008';
  end if;

  v_is_grower_initiated := public.current_role() = 'grower';

  -- plpgsql can't mix a composite target (`dpp.*`) with scalar targets in
  -- one INTO list, so the owning pick's fields are fetched as scalars
  -- here; the row itself comes back from the UPDATE ... RETURNING below.
  select dp.grower_company_id, dp.status, dp.trading_day_id, gc.name
    into v_grower_company_id, v_pick_status, v_trading_day_id, v_grower_company_name
  from public.daily_pick_products dpp
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  join public.companies gc on gc.id = dp.grower_company_id
  where dpp.id = p_daily_pick_product_id
  for update of dpp;

  if not found then
    raise exception 'NOT_FOUND: pick product line % does not exist', p_daily_pick_product_id using errcode = 'P0002';
  end if;

  if public.current_role() <> 'backoffice' and v_grower_company_id <> public.current_company_id() then
    raise exception 'FORBIDDEN: not this pick''s grower' using errcode = '42501';
  end if;

  if v_pick_status = 'closed' then
    raise exception 'INVALID_STATE: this pick is closed — no further edits are permitted' using errcode = 'P0007';
  end if;

  select coalesce(sum(quantity_pallets), 0) into v_arranged
  from public.arrangement_records
  where daily_pick_product_id = p_daily_pick_product_id;

  if p_pallets_picked < v_arranged then
    raise exception
      'CONFLICT: cannot reduce pallets picked to % — % pallets already arranged to customers for this line',
      p_pallets_picked, v_arranged
      using errcode = 'P0006';
  end if;

  update public.daily_pick_products
  set pallets_picked = p_pallets_picked, updated_at = now()
  where id = p_daily_pick_product_id
  returning * into v_line;

  if v_is_grower_initiated then
    select trade_date into v_trade_date from public.trading_days where id = v_trading_day_id;
    perform public.enqueue_backoffice_notification(
      v_trading_day_id, 'pick_updated',
      jsonb_build_object('tradeDate', v_trade_date, 'lines', '[]'::jsonb, 'companyName', v_grower_company_name)
    );
  end if;

  return v_line;
end;
$$;

comment on function public.update_pick_product_pallets(uuid, numeric) is
  'The owning grower (or backoffice). Updates a Daily Pick Product line''s pallets_picked. security definer for the same reason as submit_pick. Enforces the arrangement-edit rule: pallets_picked can never drop below the sum already committed in arrangement_records for this line (raises P0006), and rejects edits once the parent pick is closed (P0007). When the caller is the grower themselves (not backoffice acting on their behalf), enqueues one pick_updated notification_outbox row to backoffice (id 3).';

-- 6. submit_order, extended twice more:
--
-- id 6 — when the CUSTOMER themselves submits (not when backoffice
-- submits on their behalf via distributor-customer — same
-- self-notification reasoning as id 3 above), enqueue one order_submitted
-- alert to backoffice.
--
-- ids 10/11 — computed live, inside this same transaction, immediately
-- after the order lines that could have caused it are written (R5 — no
-- trigger, no stored out-of-stock list; this project's whole
-- get_orderable_catalog_for_customer design already rejected that pattern
-- once, see 0018's own header comment). Only a line whose pallets_ordered
-- increased this call can possibly push global demand up far enough to
-- cross either threshold — removing/reducing a line can only free up
-- room, never exhaust it — so only varieties present in p_lines with a
-- positive pallet count are candidates. For each candidate: demand_before
-- is snapshotted before the upsert loop runs; demand_after and supply are
-- read fresh once the loop (and the order's own status update) have
-- committed within this same transaction. Two independent crossings,
-- checked separately since either, both, or neither can be true for a
-- given variety in a single call:
--   id 10 (stock_overbooking_reached): demand crossed from below base
--     supply to at-or-above it, while overbooking room still keeps the
--     variety orderable.
--   id 11 (stock_fully_exhausted): the variety was orderable before this
--     call and is not orderable after it (supply + overbooking now fully
--     consumed).
create or replace function public.submit_order(
  p_trading_day_id uuid,
  p_lines jsonb,
  p_customer_company_id uuid default null
)
returns public.daily_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.daily_orders;
  v_phase public.trading_day_phase;
  v_trade_date date;
  v_line jsonb;
  v_kept_ids uuid[] := '{}';
  v_line_id uuid;
  v_pallets numeric;
  v_comment text;
  v_variety_id uuid;
  v_customer_company_id uuid;
  v_customer_company_name text;
  v_direct_customer_submission boolean;
  v_touched_variety_ids uuid[];
  v_demand_before_snapshot jsonb;
  v_demand_before numeric;
  v_demand_after numeric;
  v_supply numeric;
  v_overbooking numeric;
  v_product_name text;
  v_remaining numeric;
begin
  v_direct_customer_submission := p_customer_company_id is null and public.current_role() = 'customer';

  if p_customer_company_id is not null then
    if public.current_role() <> 'backoffice' then
      raise exception 'FORBIDDEN: only backoffice may submit an order on another company''s behalf' using errcode = '42501';
    end if;
    v_customer_company_id := p_customer_company_id;
  else
    if public.current_role() <> 'customer' then
      raise exception 'FORBIDDEN: customer role required' using errcode = '42501';
    end if;
    v_customer_company_id := public.current_company_id();
  end if;

  select phase, trade_date into v_phase, v_trade_date from public.trading_days where id = p_trading_day_id;
  if not found then
    raise exception 'NOT_FOUND: trading day % does not exist', p_trading_day_id using errcode = 'P0002';
  end if;
  if v_phase = 'closed' then
    raise exception 'INVALID_STATE: cannot submit an order once the trading day is closed' using errcode = 'P0007';
  end if;

  select * into v_order
  from public.daily_orders
  where trading_day_id = p_trading_day_id
    and customer_company_id = v_customer_company_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: no daily order exists for this company on this trading day' using errcode = 'P0002';
  end if;

  -- Snapshot demand-before for every variety this call could possibly
  -- push across a threshold, BEFORE the upsert loop touches anything.
  select array_agg(distinct (line ->> 'productVarietyId')::uuid)
  into v_touched_variety_ids
  from jsonb_array_elements(p_lines) as line
  where (line ->> 'palletsOrdered')::numeric > 0;

  select jsonb_object_agg(v.variety_id::text, coalesce(d.total, 0))
  into v_demand_before_snapshot
  from unnest(coalesce(v_touched_variety_ids, '{}'::uuid[])) as v(variety_id)
  left join lateral (
    select sum(dop.pallets_ordered) as total
    from public.daily_order_products dop
    join public.daily_orders do2 on do2.id = dop.daily_order_id
    where do2.trading_day_id = p_trading_day_id
      and dop.product_variety_id = v.variety_id
  ) d on true;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_pallets := (v_line ->> 'palletsOrdered')::numeric;
    v_comment := nullif(v_line ->> 'comment', '');
    v_variety_id := (v_line ->> 'productVarietyId')::uuid;

    if v_pallets < 0 then
      raise exception 'INVALID_INPUT: pallets ordered cannot be negative' using errcode = 'P0008';
    end if;

    if v_pallets = 0 then
      continue;
    end if;

    if not exists (
      select 1 from public.daily_pick_products dpp
      join public.daily_picks dp on dp.id = dpp.daily_pick_id
      where dp.trading_day_id = p_trading_day_id
        and dpp.product_variety_id = v_variety_id
    ) then
      raise exception 'INVALID_INPUT: product variety % is not in today''s shop', v_variety_id using errcode = 'P0008';
    end if;

    insert into public.daily_order_products (daily_order_id, product_variety_id, pallets_ordered, comment)
    values (v_order.id, v_variety_id, v_pallets, v_comment)
    on conflict (daily_order_id, product_variety_id)
    do update set pallets_ordered = excluded.pallets_ordered, comment = excluded.comment, updated_at = now()
    returning id into v_line_id;

    v_kept_ids := v_kept_ids || v_line_id;
  end loop;

  delete from public.daily_order_products
  where daily_order_id = v_order.id
    and not (id = any (v_kept_ids));

  update public.daily_orders
  set status = 'submitted', submitted_at = now(), updated_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into public.order_submission_logs (daily_order_id, submitted_by, snapshot)
  values (v_order.id, (select auth.uid()), p_lines);

  -- id 6.
  if v_direct_customer_submission then
    select name into v_customer_company_name from public.companies where id = v_customer_company_id;
    perform public.enqueue_backoffice_notification(
      p_trading_day_id, 'order_submitted',
      jsonb_build_object('tradeDate', v_trade_date, 'lines', '[]'::jsonb, 'companyName', v_customer_company_name)
    );
  end if;

  -- ids 10/11.
  if v_touched_variety_ids is not null then
    foreach v_variety_id in array v_touched_variety_ids
    loop
      v_demand_before := coalesce((v_demand_before_snapshot ->> v_variety_id::text)::numeric, 0);

      select coalesce(sum(dop.pallets_ordered), 0) into v_demand_after
      from public.daily_order_products dop
      join public.daily_orders do2 on do2.id = dop.daily_order_id
      where do2.trading_day_id = p_trading_day_id
        and dop.product_variety_id = v_variety_id;

      select coalesce(sum(dpp.pallets_picked), 0) + coalesce(sum(dpp.leftover_pallets), 0) into v_supply
      from public.daily_pick_products dpp
      join public.daily_picks dp on dp.id = dpp.daily_pick_id
      where dp.trading_day_id = p_trading_day_id
        and dpp.product_variety_id = v_variety_id;

      select coalesce(no_overbooking, 0), name into v_overbooking, v_product_name
      from public.product_varieties where id = v_variety_id;

      if v_demand_before < v_supply and v_demand_after >= v_supply and v_demand_after < (v_supply + v_overbooking) then
        v_remaining := (v_supply + v_overbooking) - v_demand_after;
        perform public.enqueue_backoffice_notification(
          p_trading_day_id, 'stock_overbooking_reached',
          jsonb_build_object(
            'tradeDate', v_trade_date, 'lines', '[]'::jsonb,
            'productName', v_product_name, 'productOverbooking', v_remaining::text
          )
        );
      elsif v_demand_before < (v_supply + v_overbooking) and v_demand_after >= (v_supply + v_overbooking) then
        perform public.enqueue_backoffice_notification(
          p_trading_day_id, 'stock_fully_exhausted',
          jsonb_build_object('tradeDate', v_trade_date, 'lines', '[]'::jsonb, 'productName', v_product_name)
        );
      end if;
    end loop;
  end if;

  return v_order;
end;
$$;

comment on function public.submit_order(uuid, jsonb, uuid) is
  'Customer-only for their own company (p_customer_company_id omitted). Backoffice-only when p_customer_company_id is supplied. One transaction: upserts-and-prunes daily_order_products from p_lines, sets the order to submitted and stamps submitted_at, writes one order_submission_logs row (attributed to whoever actually called this), and — only on a direct customer submission, never the backoffice-on-behalf-of path — enqueues one order_submitted notification to backoffice (id 6). Also computes, for every variety this call''s lines could have pushed across a threshold, whether it just became fully-ordered-with-overbooking-room (stock_overbooking_reached, id 10) or fully-exhausted (stock_fully_exhausted, id 11) — live, in this same transaction, never via a stored out-of-stock list or trigger. Raises P0007 if the trading day is closed, P0008 if a line references a variety not in today''s shop or has a negative pallet count.';

grant execute on function public.submit_order(uuid, jsonb, uuid) to authenticated;

-- 7. build_notification_outbox, extended: id 8 — cc the transporter.
-- A third insert, same grouping (per arranged grower) and same
-- template_key (close_arrangement_grower) as the second insert
-- immediately above it in this function — the task's own instruction is
-- "the same message", not a new transporter-specific template. Only
-- growers whose company has transporter_company_id set get a cc; a
-- transporter serving several growers gets one message per grower (not
-- one consolidated message), matching "add the same message ... to that
-- grower's assigned transporter" read literally, per-grower.
create or replace function public.build_notification_outbox(p_trading_day_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_can_see_prices boolean;
  v_trade_date date;
  v_customer_count integer;
  v_grower_count integer;
  v_transporter_count integer;
begin
  if public.current_role() <> 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  select ds.can_see_prices, td.trade_date into v_can_see_prices, v_trade_date
  from public.daily_shops ds
  join public.trading_days td on td.id = ds.trading_day_id
  where ds.trading_day_id = p_trading_day_id;

  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  select
    p_trading_day_id, 'customer', ar.customer_company_id, 'close_arrangement_customer',
    jsonb_build_object(
      'tradeDate', v_trade_date,
      'canSeePrices', coalesce(v_can_see_prices, false),
      'lines', jsonb_agg(jsonb_build_object(
        'familyName', pf.name,
        'varietyName', pv.name,
        'quantityPallets', ar.quantity_pallets,
        'price', case when v_can_see_prices then ar.price else null end,
        'growerCompanyName', gc.name
      ))
    )
  from public.arrangement_records ar
  join public.daily_order_products dop on dop.id = ar.daily_order_product_id
  join public.daily_orders do2 on do2.id = dop.daily_order_id
  join public.product_varieties pv on pv.id = dop.product_variety_id
  join public.product_families pf on pf.id = pv.family_id
  join public.daily_pick_products dpp on dpp.id = ar.daily_pick_product_id
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  join public.companies gc on gc.id = dp.grower_company_id
  where do2.trading_day_id = p_trading_day_id
    and ar.quantity_pallets > 0
    and do2.status <> 'open'
  group by ar.customer_company_id;
  get diagnostics v_customer_count = row_count;

  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  select
    p_trading_day_id, 'grower', dp.grower_company_id, 'close_arrangement_grower',
    jsonb_build_object(
      'tradeDate', v_trade_date,
      'lines', jsonb_agg(jsonb_build_object(
        'familyName', pf.name,
        'varietyName', pv.name,
        'quantityPallets', ar.quantity_pallets,
        'customerCompanyName', cc.name
      ))
    )
  from public.arrangement_records ar
  join public.daily_pick_products dpp on dpp.id = ar.daily_pick_product_id
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  join public.product_varieties pv on pv.id = dpp.product_variety_id
  join public.product_families pf on pf.id = pv.family_id
  join public.companies cc on cc.id = ar.customer_company_id
  where dp.trading_day_id = p_trading_day_id
    and ar.quantity_pallets > 0
  group by dp.grower_company_id;
  get diagnostics v_grower_count = row_count;

  insert into public.notification_outbox (trading_day_id, recipient_type, recipient_company_id, template_key, payload)
  select
    p_trading_day_id, 'transporter', gc.transporter_company_id, 'close_arrangement_grower',
    jsonb_build_object(
      'tradeDate', v_trade_date,
      'lines', jsonb_agg(jsonb_build_object(
        'familyName', pf.name,
        'varietyName', pv.name,
        'quantityPallets', ar.quantity_pallets,
        'customerCompanyName', cc.name
      ))
    )
  from public.arrangement_records ar
  join public.daily_pick_products dpp on dpp.id = ar.daily_pick_product_id
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  join public.companies gc on gc.id = dp.grower_company_id
  join public.product_varieties pv on pv.id = dpp.product_variety_id
  join public.product_families pf on pf.id = pv.family_id
  join public.companies cc on cc.id = ar.customer_company_id
  where dp.trading_day_id = p_trading_day_id
    and ar.quantity_pallets > 0
    and gc.transporter_company_id is not null
  group by dp.grower_company_id, gc.transporter_company_id;
  get diagnostics v_transporter_count = row_count;

  return v_customer_count + v_grower_count + v_transporter_count;
end;
$$;

comment on function public.build_notification_outbox(uuid) is
  'Backoffice-only. Writes one notification_outbox row per grower/customer company with arranged pallets for this trading day, plus one more per grower with an assigned transporter (id 8 — same close_arrangement_grower template content, cc''d to the transporter, one message per grower even if a transporter serves several) — a durable, transactional stand-in for the source''s synchronous WhatsApp dispatch. Returns the number of rows written.';

-- 8. Seed the five new templates ids 3/4/6/10/11 need (id 8 reuses
-- close_arrangement_grower as-is — no new template row).
insert into public.notification_templates (template_key, channel, title, content, link) values
  (
    'shop_open',
    'whatsapp',
    'החנות פתוחה',
    '%FIRST_NAME% שלום,%NL%החנות כעת פתוחה להזמנות.',
    null
  ),
  (
    'pick_updated',
    'whatsapp',
    'עדכון קטיף',
    '%FIRST_NAME% שלום,%NL%%COMPANY% עדכן/ה את הערכת הקטיף ליום %CURRENT_OPEN_BUSINESS_DAY%.',
    null
  ),
  (
    'order_submitted',
    'whatsapp',
    'הזמנה חדשה',
    '%FIRST_NAME% שלום,%NL%%COMPANY% שלחו הזמנה ליום %CURRENT_OPEN_BUSINESS_DAY%.',
    null
  ),
  (
    'stock_overbooking_reached',
    'whatsapp',
    'מלאי אוזל',
    '%FIRST_NAME% שלום,%NL%כל המשטחים שנקטפו עבור %PRODUCT_NAME% הוזמנו. האפשרות להזמין תשאר פתוחה לעוד %PRODUCT_OVERBOOKING% משטחים עבור מוצר זה.',
    null
  ),
  (
    'stock_fully_exhausted',
    'whatsapp',
    'מלאי אזל',
    '%FIRST_NAME% שלום,%NL%כל המשטחים + אוברבוקינג עבור %PRODUCT_NAME% הוזמנו. לא ניתן יותר להזמין ממוצר זה במערכת.',
    null
  );
