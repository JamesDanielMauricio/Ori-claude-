-- What a customer sees in the shop: prices only with permission, and never a
-- product blocked for them — both as Bubble did it.
--
-- 1. PRICES. Bubble showed a customer a price only when BOTH their company's
--    "Can see product prices" AND the day's shop "can see prices?" were on
--    (customer_order_interface (new): the price text's visibility
--    condition). Ori checked only the day's switch, so on any day the shop
--    showed prices, every customer saw them — including the companies whose
--    permission is off (37 of the 56 customer companies on 2026-11-06). The
--    day's switch was also read from whatever day the CALLER passed in, while
--    the prices returned are always the varieties' current ones: on a day
--    the distributor hid prices, a customer could still read them by asking
--    for an earlier day's catalog.
--    Now a customer sees prices only for a day that is not closed (at most
--    one day is not closed: the one being traded), only when that day's shop
--    shows prices, and only when their own company may see them. A missing
--    permission counts as "may not" — Bubble's "is yes" is false for an
--    empty value, and Ori's customer form saves false by default. Staff
--    (backoffice) are unchanged: their screens show prices whenever the
--    day's shop does.
--
-- 2. BLOCKED PRODUCTS. The Users screen keeps a per-user list of blocked
--    products (profile_blocked_products — Bubble's "Products Blacklist",
--    imported family by family), but nothing read it: a blocked product was
--    shown and orderable as normal. Bubble hid it from that user's shop list
--    — only for a customer, only by their own list (a colleague in the same
--    company still saw it), and even when it was already in the company's
--    order; staff ordering on the customer's behalf saw everything. Now:
--      - get_orderable_catalog_for_customer leaves a customer's blocked
--        products out of their own list (staff lists are unchanged);
--      - submit_order, on a customer's own send, neither adds, changes nor
--        removes a line for a product blocked for them. The order screen
--        sends back only the lines it shows, and submit_order removes every
--        line it is not sent — so without this, a blocked customer's save
--        would delete a colleague's (or the distributor's) line for that
--        product only because the blocked customer cannot see it. Bubble
--        saved only the lines a user changed, so it never had that problem.
--
-- Both functions are copied unchanged from their latest definitions —
-- get_orderable_catalog_for_customer from 0064, submit_order from 0071 —
-- apart from the blocks marked "0072". Safe to run more than once.

-- ---------------------------------------------------------------------------
-- get_orderable_catalog_for_customer
-- ---------------------------------------------------------------------------

-- SECURITY (unchanged from 0064, restated because the function is replaced):
-- which of the two lists a caller gets is decided by their ROLE, read from
-- their profile (current_role()), never by anything they pass in. That ALLOWS
-- backoffice to see fully ordered products and existing order lines that
-- customers do not, and it PROTECTS AGAINST a customer asking for the
-- distributor's list: there is no parameter that switches it, and the only
-- parameter that reaches another company's catalog (p_customer_company_id) is
-- still refused for everyone but backoffice (42501). ALLOWS a signed-in user
-- with a profile to read the catalog for THEIR OWN company, and backoffice to
-- read any customer's. PROTECTS AGAINST a caller with no profile (`is
-- distinct from` counts "no role" as "not backoffice", and a caller with no
-- company of their own is refused outright — this function runs as its
-- owner, so RLS is not there to catch either case) and anonymous calls
-- (execute is revoked from anon below). The picking check reads every
-- grower's pick lines, which the caller could not read themselves; it only
-- decides whether a row is listed at all, and no pick line or other company's
-- figure is ever returned.
create or replace function public.get_orderable_catalog_for_customer(
  p_trading_day_id uuid,
  p_customer_company_id uuid default null
)
returns table (
  family_id uuid,
  family_name text,
  variety_id uuid,
  variety_name text,
  sizes text,
  pack_type public.pack_type,
  price numeric,
  price_range_from numeric,
  price_range_to numeric,
  price_type text,
  is_orderable boolean,
  pallets_ordered numeric,
  comment text,
  image_url text,
  max_orderable_for_customer numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_target_company_id uuid;
  v_staff_view boolean;
  v_customer_caller boolean;
  v_caller_sees_prices boolean;
begin
  if p_customer_company_id is not null then
    if public.current_role() is distinct from 'backoffice' then
      raise exception 'FORBIDDEN: only backoffice may query another company''s catalog' using errcode = '42501';
    end if;
    v_target_company_id := p_customer_company_id;
  else
    v_target_company_id := public.current_company_id();
    if v_target_company_id is null then
      raise exception 'FORBIDDEN: no profile for this account' using errcode = '42501';
    end if;
  end if;

  -- The distributor's list or the customer's, by role. `coalesce` because a
  -- role of NULL (no profile) must count as "not backoffice"; such a caller is
  -- refused above anyway.
  v_staff_view := coalesce(public.current_role() = 'backoffice', false);
  v_customer_caller := coalesce(public.current_role() = 'customer', false);

  -- 0072: PRICES. SECURITY: ALLOWS a customer to see prices only for a day
  -- that is not closed — the day being traded, whose prices these are —
  -- when their own company's can_see_product_prices is on; the day's shop
  -- switch (ds.can_see_prices, in the select below) must be on as well. It
  -- PROTECTS AGAINST a company without price permission seeing prices (Bubble
  -- never showed them one), and against any customer reading today's prices
  -- by passing an older day's id: the prices returned are the varieties'
  -- CURRENT ones, so the switch that guards them must be the current day's,
  -- not the switch of whichever day the caller names. A missing permission
  -- or a day that does not exist counts as "no prices". Staff are unchanged:
  -- they see prices whenever the day's shop shows them.
  if v_staff_view then
    v_caller_sees_prices := true;
  else
    select coalesce(c.can_see_product_prices, false) and td.phase <> 'closed'
    into v_caller_sees_prices
    from public.companies c
    cross join public.trading_days td
    where c.id = v_target_company_id
      and td.id = p_trading_day_id;
    v_caller_sees_prices := coalesce(v_caller_sees_prices, false);
  end if;

  return query
  select
    pf.id as family_id,
    pf.name as family_name,
    pv.id as variety_id,
    pv.name as variety_name,
    pv.sizes,
    pv.pack_type,
    case when v_caller_sees_prices and ds.can_see_prices then pv.price else null end as price,
    case when v_caller_sees_prices and ds.can_see_prices then pv.price_range_from else null end as price_range_from,
    case when v_caller_sees_prices and ds.can_see_prices then pv.price_range_to else null end as price_range_to,
    case when v_caller_sees_prices and ds.can_see_prices then pv.price_type else null end as price_type,
    sv.is_orderable,
    coalesce(dop.pallets_ordered, 0) as pallets_ordered,
    dop.comment,
    pf.image_url,
    public.max_orderable_for_customer(p_trading_day_id, pv.id, v_target_company_id) as max_orderable_for_customer
  from public.shop_variety_orderability(p_trading_day_id) sv
  join public.product_varieties pv on pv.id = sv.product_variety_id
  join public.product_families pf on pf.id = pv.family_id
  join public.daily_shops ds on ds.trading_day_id = p_trading_day_id
  -- Picking per variety for this day, across every grower and whatever the
  -- state of their pick (a draft counts, as it does in shop_variety_orderability).
  -- Both columns are NOT NULL, so the sum is never null.
  left join (
    select dpp.product_variety_id, sum(dpp.pallets_picked) + sum(dpp.leftover_pallets) as total
    from public.daily_pick_products dpp
    join public.daily_picks dp on dp.id = dpp.daily_pick_id
    where dp.trading_day_id = p_trading_day_id
    group by dpp.product_variety_id
  ) picking on picking.product_variety_id = pv.id
  left join public.daily_orders ord
    on ord.trading_day_id = p_trading_day_id
    and ord.customer_company_id = v_target_company_id
  left join public.daily_order_products dop
    on dop.daily_order_id = ord.id
    and dop.product_variety_id = pv.id
  where
    -- A customer: has picking, and either still has room to order or is already
    -- in their own order. no_overbooking is deliberately not part of "has
    -- picking": it only stretches how much of a picked product can be ordered
    -- (that is is_orderable's job), it is not stock.
    (not v_staff_view
      and coalesce(picking.total, 0) > 0
      and (sv.is_orderable or dop.id is not null)
      -- 0072: BLOCKED PRODUCTS. SECURITY: ALLOWS a customer to be shown only
      -- the products that are not on their own blocked list — even one
      -- already in their company's order, as in Bubble, where the list
      -- filtered every product the customer was shown. It PROTECTS AGAINST a
      -- blocked product being offered to, and so ordered by, the customer it
      -- was blocked for. Their own list only: a colleague in the same company
      -- is unaffected, and so is staff's list (the other branch below).
      and not (v_customer_caller and exists (
        select 1 from public.profile_blocked_products b
        where b.user_id = (select auth.uid())
          and b.product_variety_id = pv.id
      )))
    -- A distributor: everything that has picking, fully ordered or not, plus
    -- whatever is already in the order they are looking at.
    or (v_staff_view
      and (coalesce(picking.total, 0) > 0 or dop.id is not null))
  order by pf.name, pv.name;
end;
$$;

comment on function public.get_orderable_catalog_for_customer(uuid, uuid) is
  'Security definer (migration 0056), so customers — who cannot read product_varieties directly — can still browse the catalog. A signed-in user with a profile reads their own company''s catalog (p_customer_company_id omitted); backoffice may pass p_customer_company_id to read any customer''s — raises FORBIDDEN for any other caller, and for an account with no profile. Customers and distributors get different lists, chosen by the caller''s role (never by a parameter), migration 0064. Picking = pallets_picked + leftover_pallets summed over every grower for the day; no_overbooking is not picking. A CUSTOMER sees a variety when it has picking AND it is not fully ordered (is_orderable), or when it has picking and is already in their own order (so a fully ordered product stays visible to whoever ordered it) — except a variety on the calling customer''s own blocked list (profile_blocked_products), which is never shown to them, even when it is in their order (migration 0072). A variety whose picking is 0 is not shown to a customer even if it is in their order. A DISTRIBUTOR (backoffice) sees every variety that has picking, fully ordered or not (is_orderable is false for those), plus every line already in the target company''s order whatever its picking; blocked lists do not apply to them. Prices: a customer gets them only when the day is not closed, the day''s daily_shops.can_see_prices is on AND their company''s can_see_product_prices is on (migration 0072, as in Bubble); backoffice gets them whenever the day''s daily_shops.can_see_prices is on. This is the only way a customer sees a price. sizes is the variety''s free-text size descriptor (product_varieties.sizes), meant to be shown beside variety_name. image_url is the variety''s family''s photo. max_orderable_for_customer is the target company''s own ceiling for that row (see max_orderable_for_customer()) — always populated, including on the backoffice on-behalf-of path, but only the customer''s own order screen''s UI treats it as a hard limit; the backoffice edit path lets staff override it.';

-- SECURITY: ALLOWS only signed-in users to run the function; PROTECTS AGAINST
-- anonymous callers (no session) reaching it at all. `create or replace` keeps
-- the grants it had, and these two lines state them again so this file is the
-- whole truth about who may call it.
revoke execute on function public.get_orderable_catalog_for_customer(uuid, uuid) from public, anon;
grant execute on function public.get_orderable_catalog_for_customer(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_order
-- ---------------------------------------------------------------------------

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
  v_max_orderable numeric;
  v_saved_pallets numeric;
  v_blocked_variety_ids uuid[] := '{}';
begin
  v_direct_customer_submission := p_customer_company_id is null and public.current_role() = 'customer';

  -- SECURITY: ALLOWS a customer to send their own company's order, and a
  -- backoffice account to send any customer's order on their behalf ("בשם
  -- לקוח"). PROTECTS AGAINST a customer or grower writing another company's
  -- order, or a grower ordering at all. Unchanged from 0042. A caller with no
  -- profile at all has a NULL role, so neither check below raises for them —
  -- but their company is NULL too, no daily order matches it, and the
  -- NOT_FOUND check further down stops them before anything is written.
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

  -- 0071: `for share` — read the day's phase and keep it from changing until
  -- this send is done. ALLOWS any number of order sends at once (shared locks
  -- don't block each other). PROTECTS AGAINST a send and a phase change
  -- crossing: open_shop, close_shop and close_arrangement all start by
  -- locking this same row `for update`, so a send that arrives while the
  -- shop is closing waits for the close to finish and then sees the new
  -- phase, and a close that arrives during a send waits for the send. They
  -- lock nothing before this row, so the two can never wait on each other in
  -- a circle.
  select phase, trade_date into v_phase, v_trade_date from public.trading_days where id = p_trading_day_id for share;
  if not found then
    raise exception 'NOT_FOUND: trading day % does not exist', p_trading_day_id using errcode = 'P0002';
  end if;
  if v_phase = 'closed' then
    raise exception 'INVALID_STATE: cannot submit an order once the trading day is closed' using errcode = 'P0007';
  end if;

  -- 0071: SHOP HOURS — ALLOWS a customer to send their own order only while
  -- the shop is open (phase shop_open). PROTECTS AGAINST an order changing
  -- after close_shop, while the distributor is already arranging from the
  -- numbers — the order screen checks this before sending, but a send in the
  -- moment of closing, from a screen that missed the close, or straight
  -- through the API, used to be accepted until the whole day closed. Staff
  -- ordering on a customer's behalf ("בשם לקוח") are not limited by this:
  -- they may still adjust orders while arranging, up to the day's close (the
  -- check above).
  if v_direct_customer_submission and v_phase <> 'shop_open' then
    raise exception 'INVALID_STATE: the shop is closed for orders' using errcode = 'P0007';
  end if;

  select * into v_order
  from public.daily_orders
  where trading_day_id = p_trading_day_id
    and customer_company_id = v_customer_company_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: no daily order exists for this company on this trading day' using errcode = 'P0002';
  end if;

  -- 0068: STOCK — one order send at a time for each trading day.
  -- ALLOWS every send to go through exactly as before, only in turn.
  -- PROTECTS AGAINST two customers taking the same last pallets. Each send
  -- checks how much is still free (max_orderable_for_customer, below) against
  -- what OTHER customers have already ordered; without this, two sends running
  -- at the same moment each read the stock before the other had saved, both
  -- passed, and together ordered more than exists (reproduced on Postgres 17:
  -- 7 + 7 accepted against 10). Now the second send waits — milliseconds —
  -- for the first to finish, then sees its order. Taken only here, once the
  -- caller is known to have an order for this day, so a call that is refused
  -- above (anonymous, no profile, wrong role, no order) never holds anyone up.
  -- A transaction-level advisory lock: released by itself when this send
  -- commits or fails, and taken nowhere else in the database. Every send locks
  -- its own order row (just above) before this, and touches no other order,
  -- so two sends can never wait on each other in a circle. Backoffice sends
  -- take it too: their pallets count against what customers may still order.
  perform pg_advisory_xact_lock(hashtextextended('submit_order:' || p_trading_day_id::text, 0));

  -- 0072: BLOCKED PRODUCTS. SECURITY: on a customer's own send, ALLOWS
  -- changes only to lines for products that are not on their own blocked
  -- list; a line for a blocked product is left exactly as it is — not
  -- added, not changed, not removed. It PROTECTS AGAINST a customer ordering
  -- a product blocked for them by calling this directly (their order screen
  -- no longer shows one — get_orderable_catalog_for_customer, above), and
  -- against their save deleting a colleague's or the distributor's line for
  -- that product: they are never shown it, so it is never in what they send,
  -- and the prune below would otherwise take every line it is not sent.
  -- Ignored rather than refused, so a screen opened before the block was set
  -- can still save everything else. Staff sending on a customer's behalf are
  -- not affected (Bubble's list, too, applied only to the customer's own
  -- shop).
  if v_direct_customer_submission then
    select coalesce(array_agg(b.product_variety_id), '{}')
    into v_blocked_variety_ids
    from public.profile_blocked_products b
    where b.user_id = (select auth.uid());
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

    -- 0072: a product blocked for this customer — see BLOCKED PRODUCTS above.
    if v_variety_id = any (v_blocked_variety_ids) then
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

    -- The dropdown's own ceiling, re-checked server-side so a direct API
    -- call can't exceed what the UI offered — never applied to the
    -- backoffice on-behalf-of path, where staff may deliberately override
    -- it (see max_orderable_for_customer's comment).
    --
    -- 0068: and only to a line that goes UP. A quantity the customer already
    -- has saved stays theirs when stock later drops below it: re-sending the
    -- order with that line untouched, or lowering it, is accepted, and only
    -- an increase is held to the limit. The order screen's dropdown already
    -- keeps the saved number on offer for exactly this case (see
    -- dropdownOptions in apps/web/src/components/customer/order-product-list.tsx),
    -- as Bubble's did; until now the server then refused the whole send
    -- because of it, losing every other change the customer had made.
    if v_direct_customer_submission then
      select pallets_ordered into v_saved_pallets
      from public.daily_order_products
      where daily_order_id = v_order.id and product_variety_id = v_variety_id;

      if v_pallets > coalesce(v_saved_pallets, 0) then
        v_max_orderable := public.max_orderable_for_customer(p_trading_day_id, v_variety_id, v_customer_company_id);
        if v_pallets > v_max_orderable then
          raise exception 'INVALID_INPUT: % pallets requested exceeds the % pallet limit available for this product', v_pallets, v_max_orderable
            using errcode = 'P0008';
        end if;
      end if;
    end if;

    insert into public.daily_order_products (daily_order_id, product_variety_id, pallets_ordered, comment)
    values (v_order.id, v_variety_id, v_pallets, v_comment)
    on conflict (daily_order_id, product_variety_id)
    do update set pallets_ordered = excluded.pallets_ordered, comment = excluded.comment, updated_at = now()
    returning id into v_line_id;

    v_kept_ids := v_kept_ids || v_line_id;
  end loop;

  -- Prune, but never destroy an allocation.
  --
  -- This used to be a bare DELETE of every line not present in p_lines,
  -- and arrangement_records.daily_order_product_id is ON DELETE CASCADE —
  -- so re-saving an order silently deleted the distributor's arrangement
  -- records for any line it dropped. That was already true for ordinary
  -- lines; it becomes a certainty with the zero-quantity lines
  -- arrange_to_customer creates, because submit_order skips zero-pallet
  -- lines entirely (see the `continue` above) and therefore never keeps
  -- one.
  --
  -- A line that something is arranged against is zeroed instead: the
  -- customer's request really is gone, which is what pallets_ordered = 0
  -- now means, but the pallets already committed to them stay visible on
  -- the arrangement board for the distributor to settle deliberately.
  --
  -- 0072: neither touches a line for a product blocked for this customer
  -- (v_blocked_variety_ids is empty for every other caller) — see BLOCKED
  -- PRODUCTS above.
  update public.daily_order_products
  set pallets_ordered = 0, comment = null, updated_at = now()
  where daily_order_id = v_order.id
    and not (id = any (v_kept_ids))
    and not (product_variety_id = any (v_blocked_variety_ids))
    and exists (
      select 1 from public.arrangement_records ar
      where ar.daily_order_product_id = daily_order_products.id
    );

  delete from public.daily_order_products
  where daily_order_id = v_order.id
    and not (id = any (v_kept_ids))
    and not (product_variety_id = any (v_blocked_variety_ids))
    and not exists (
      select 1 from public.arrangement_records ar
      where ar.daily_order_product_id = daily_order_products.id
    );

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
            'productName', v_product_name,
            'productOverbooking', regexp_replace(v_remaining::text, '\.?0+$', '')
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
  'Customer-only for their own company (p_customer_company_id omitted). Backoffice-only when p_customer_company_id is supplied. One transaction: upserts-and-prunes daily_order_products from p_lines, sets the order to submitted and stamps submitted_at, writes one order_submission_logs row (attributed to whoever actually called this), and — only on a direct customer submission, never the backoffice-on-behalf-of path — enqueues one order_submitted notification to backoffice (id 6) and rejects (P0008) any line raised above max_orderable_for_customer() for that variety (a line kept at, or lowered from, its saved quantity is accepted even when stock has since dropped below it — migration 0068). On a direct customer submission, a line for a product on the calling user''s own blocked list (profile_blocked_products) is ignored if sent and never pruned: it is left exactly as it was (migration 0072). Also computes, for every variety this call''s lines could have pushed across a threshold, whether it just became fully-ordered-with-overbooking-room (stock_overbooking_reached, id 10) or fully-exhausted (stock_fully_exhausted, id 11) — live, in this same transaction, never via a stored out-of-stock list or trigger. A pruned line that an arrangement_records row points at is zeroed rather than deleted, so re-saving an order can no longer cascade away the distributor''s allocations. Sends for one trading day run one at a time (a transaction-level advisory lock, 0068), so two customers can never both take the same last pallets. Raises P0007 if the trading day is closed, or — for a customer''s own order — if the shop is not open (phase shop_open; migration 0071, which also reads the phase `for share` so a send and close_shop can never cross), P0008 if a line references a variety not in today''s shop, has a negative pallet count, or (direct customer submissions only) raises a line above the per-customer cap.';

grant execute on function public.submit_order(uuid, jsonb, uuid) to authenticated;
