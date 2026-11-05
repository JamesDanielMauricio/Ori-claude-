-- Two fixes to sending a customer's order (submit_order), both about the
-- per-customer stock limit that 0042 added. The function is copied unchanged
-- from 0042, its latest definition, apart from the blocks marked "0068" and
-- comments explaining the existing role checks.
--
-- 1. A line the customer already saved no longer blocks the whole order.
--    The limit is "how much is still free for you": stock + overbooking
--    allowance, minus what OTHER customers have ordered. It moves during the
--    day — a grower lowers a pick, another customer orders. When it fell
--    below a line the customer had already saved, every later send was
--    refused ("6 pallets requested exceeds the 4 pallet limit", in English),
--    even one that only changed another product — that change was lost, and
--    the customer could not even lower the line. Now only a line that goes UP
--    is held to the limit; a saved quantity stays allowed. This is what
--    Bubble did (its quantity list kept the saved number, and its server
--    checked nothing), and what Ori's own dropdown already offers.
--
-- 2. Two customers can no longer both take the same last pallets.
--    Each send checks the limit against what is saved at that moment. Two
--    sends running at the same instant each checked before the other had
--    saved, so both passed: on a real Postgres 17 server, 7 + 7 pallets were
--    accepted against 10 in stock. Sends for one trading day now run one at
--    a time — the second waits a few milliseconds for the first, then checks
--    against it. Nothing else waits on this.
--
-- Unchanged on purpose: the backoffice "בשם לקוח" path still skips the limit
-- (staff may exceed it); the per-customer caps in product_customer_caps are
-- still not enforced (that is an open decision, not part of this fix).
-- Safe to run more than once (create or replace, comment on, grant).

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
  update public.daily_order_products
  set pallets_ordered = 0, comment = null, updated_at = now()
  where daily_order_id = v_order.id
    and not (id = any (v_kept_ids))
    and exists (
      select 1 from public.arrangement_records ar
      where ar.daily_order_product_id = daily_order_products.id
    );

  delete from public.daily_order_products
  where daily_order_id = v_order.id
    and not (id = any (v_kept_ids))
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
  'Customer-only for their own company (p_customer_company_id omitted). Backoffice-only when p_customer_company_id is supplied. One transaction: upserts-and-prunes daily_order_products from p_lines, sets the order to submitted and stamps submitted_at, writes one order_submission_logs row (attributed to whoever actually called this), and — only on a direct customer submission, never the backoffice-on-behalf-of path — enqueues one order_submitted notification to backoffice (id 6) and rejects (P0008) any line raised above max_orderable_for_customer() for that variety (a line kept at, or lowered from, its saved quantity is accepted even when stock has since dropped below it — migration 0068). Also computes, for every variety this call''s lines could have pushed across a threshold, whether it just became fully-ordered-with-overbooking-room (stock_overbooking_reached, id 10) or fully-exhausted (stock_fully_exhausted, id 11) — live, in this same transaction, never via a stored out-of-stock list or trigger. A pruned line that an arrangement_records row points at is zeroed rather than deleted, so re-saving an order can no longer cascade away the distributor''s allocations. Sends for one trading day run one at a time (a transaction-level advisory lock, 0068), so two customers can never both take the same last pallets. Raises P0007 if the trading day is closed, P0008 if a line references a variety not in today''s shop, has a negative pallet count, or (direct customer submissions only) raises a line above the per-customer cap.';

grant execute on function public.submit_order(uuid, jsonb, uuid) to authenticated;
