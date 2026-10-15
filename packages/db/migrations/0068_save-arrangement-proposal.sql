-- Saves a whole arrangement proposal ("שמור לסידור" under "הצע סידור" on the
-- arrangement-by-products screen) in ONE transaction, filling only cells
-- (pick line × customer) that are still empty.
--
-- It replaces a loop in the browser that called arrange_to_customer once per
-- cell. That loop broke R4 — a refusal half-way left half the day saved —
-- and, because arrange_to_customer UPDATES a record it finds, it overwrote any
-- cell someone filled between the proposal being read and the save landing.
-- Here a refusal anywhere saves nothing, and a cell filled meanwhile is
-- refused, never overwritten.
--
-- Each allocation still goes through arrange_to_customer (0040), so its rules
-- live in one place (R6): the backoffice check, the open-arrangement check,
-- the zero-pallet order line it creates for a customer who did not order the
-- product, and check_arrangement_allocation (0050) — whose sums see this
-- transaction's own inserts, so a customer given the same product off two
-- lots is held to their order across both.
--
-- Locks (R7), the trading day first, in the order close_arrangement,
-- discard_business_day and sync_grower_picks take theirs:
--   1. trading_days FOR SHARE. close_arrangement locks only the day, and
--      closes the arrangement row last, after writing leftovers and prices;
--      without this a save could land inside a close — unpriced, and missing
--      from the leftovers it had just computed.
--   2. daily_arrangements FOR UPDATE. Every arrangement-record writer (0021,
--      0040) takes it, so "this cell is still empty" stays true until commit.
--   3. The pick lines touched, FOR SHARE, in id order. The allocation check
--      reads pallets_picked without a lock, and save_pick_lines (0050) could
--      lower it under the check.
--   4. The order headers of the customers involved, FOR UPDATE, in id order.
--      submit_order changes a customer's lines under that row's lock, so
--      "this customer still has that order" stays true until commit.
--
-- A cell marked forOrder was meant to fill the customer's order — the screen
-- suggested it, or the distributor corrected a suggestion. If that order has
-- gone (withdrawn in the moments since the proposal was read), the cell is
-- refused rather than saved: arrange_to_customer would otherwise make it a
-- push, and close_arrangement would then price and announce pallets the
-- customer took back. A cell without the mark is the distributor's own, push
-- or not, and is saved as it is.
--
-- p_allocations: [{ "dailyPickProductId": uuid, "customerCompanyId": uuid,
--                   "quantityPallets": whole number above zero,
--                   "forOrder": true | false (optional) }, ...]
--
-- Written to be re-run.

create or replace function public.save_arrangement_proposal(
  p_trading_day_id uuid,
  p_allocations jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_arrangement public.daily_arrangements;
  v_bad jsonb;
  v_record public.arrangement_records;
  v_saved integer := 0;
  v_index bigint;
  v_pick_line_id uuid;
  v_customer_id uuid;
  v_quantity numeric;
  v_state text;
  v_message text;
begin
  -- `is distinct from`, not `<>`: a caller with no profile has a NULL role.
  if public.current_role() is distinct from 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'INVALID_INPUT: allocations must be a JSON array' using errcode = 'P0008';
  end if;

  perform 1 from public.trading_days where id = p_trading_day_id for share;
  if not found then
    raise exception 'NOT_FOUND: trading day % does not exist', p_trading_day_id using errcode = 'P0002';
  end if;

  select * into v_arrangement
  from public.daily_arrangements
  where trading_day_id = p_trading_day_id
  for update;
  if not found then
    raise exception 'NOT_FOUND: no arrangement exists for trading day %', p_trading_day_id using errcode = 'P0002';
  end if;
  if v_arrangement.status <> 'open' then
    raise exception 'INVALID_STATE: the arrangement is closed' using errcode = 'P0007';
  end if;

  -- Every allocation well formed, before anything is read by it.
  select jsonb_agg(e.ord - 1 order by e.ord) into v_bad
  from jsonb_array_elements(p_allocations) with ordinality as e(elem, ord)
  where jsonb_typeof(e.elem -> 'dailyPickProductId') is distinct from 'string'
     or jsonb_typeof(e.elem -> 'customerCompanyId') is distinct from 'string'
     or (e.elem ->> 'dailyPickProductId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (e.elem ->> 'customerCompanyId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or case
          when jsonb_typeof(e.elem -> 'quantityPallets') = 'number'
            then (e.elem ->> 'quantityPallets')::numeric <= 0
              or (e.elem ->> 'quantityPallets')::numeric % 1 <> 0
          else true
        end
     or (e.elem ? 'forOrder' and jsonb_typeof(e.elem -> 'forOrder') <> 'boolean');
  if v_bad is not null then
    raise exception 'INVALID_INPUT: each allocation needs a pick line, a customer and a whole number of pallets above zero'
      using errcode = 'P0008', detail = jsonb_build_object('indexes', v_bad)::text;
  end if;

  -- One entry per cell: a second would find the first's record and read as a
  -- conflict with itself.
  select jsonb_agg(jsonb_build_object('dailyPickProductId', d.pick_line_id, 'customerCompanyId', d.customer_id))
    into v_bad
  from (
    select (e.elem ->> 'dailyPickProductId')::uuid as pick_line_id,
           (e.elem ->> 'customerCompanyId')::uuid as customer_id
    from jsonb_array_elements(p_allocations) as e(elem)
    group by 1, 2
    having count(*) > 1
  ) d;
  if v_bad is not null then
    raise exception 'INVALID_INPUT: a cell appears more than once'
      using errcode = 'P0008', detail = jsonb_build_object('cells', v_bad)::text;
  end if;

  select jsonb_agg(distinct e.elem ->> 'dailyPickProductId') into v_bad
  from jsonb_array_elements(p_allocations) as e(elem)
  where not exists (
    select 1
    from public.daily_pick_products dpp
    join public.daily_picks dp on dp.id = dpp.daily_pick_id
    where dpp.id = (e.elem ->> 'dailyPickProductId')::uuid
      and dp.trading_day_id = p_trading_day_id
  );
  if v_bad is not null then
    raise exception 'NOT_FOUND: % pick line(s) are not on trading day %', jsonb_array_length(v_bad), p_trading_day_id
      using errcode = 'P0002', detail = jsonb_build_object('pickLineIds', v_bad)::text;
  end if;

  perform 1
  from public.daily_pick_products
  where id in (
    select (e.elem ->> 'dailyPickProductId')::uuid from jsonb_array_elements(p_allocations) as e(elem)
  )
  order by id
  for share;

  perform 1
  from public.daily_orders
  where trading_day_id = p_trading_day_id
    and customer_company_id in (
      select (e.elem ->> 'customerCompanyId')::uuid from jsonb_array_elements(p_allocations) as e(elem)
    )
  order by id
  for update;

  -- Meant for an order that has gone since the proposal was read: the whole
  -- save is refused, naming every such cell at once.
  select jsonb_agg(jsonb_build_object(
           'index', e.ord - 1,
           'dailyPickProductId', e.elem ->> 'dailyPickProductId',
           'customerCompanyId', e.elem ->> 'customerCompanyId') order by e.ord)
    into v_bad
  from jsonb_array_elements(p_allocations) with ordinality as e(elem, ord)
  where (e.elem -> 'forOrder') = 'true'::jsonb
    and not exists (
      select 1
      from public.daily_pick_products dpp
      join public.daily_order_products dop on dop.product_variety_id = dpp.product_variety_id
      join public.daily_orders o on o.id = dop.daily_order_id
      where dpp.id = (e.elem ->> 'dailyPickProductId')::uuid
        and o.trading_day_id = p_trading_day_id
        and o.customer_company_id = (e.elem ->> 'customerCompanyId')::uuid
        and dop.pallets_ordered > 0
    );
  if v_bad is not null then
    raise exception 'CONFLICT: % cell(s) of this proposal are no longer ordered', jsonb_array_length(v_bad)
      using errcode = 'P0006', detail = jsonb_build_object('cells', v_bad)::text;
  end if;

  -- Filled since the proposal was read: the whole save is refused, naming
  -- every such cell at once. A cell's customer is read off its order line,
  -- and off the record's own copy as well, as the grid reads it.
  select jsonb_agg(jsonb_build_object(
           'index', e.ord - 1,
           'dailyPickProductId', e.elem ->> 'dailyPickProductId',
           'customerCompanyId', e.elem ->> 'customerCompanyId') order by e.ord)
    into v_bad
  from jsonb_array_elements(p_allocations) with ordinality as e(elem, ord)
  where exists (
    select 1
    from public.arrangement_records ar
    left join public.daily_order_products dop on dop.id = ar.daily_order_product_id
    left join public.daily_orders o on o.id = dop.daily_order_id
    where ar.daily_pick_product_id = (e.elem ->> 'dailyPickProductId')::uuid
      and (o.customer_company_id = (e.elem ->> 'customerCompanyId')::uuid
           or ar.customer_company_id = (e.elem ->> 'customerCompanyId')::uuid)
  );
  if v_bad is not null then
    raise exception 'CONFLICT: % cell(s) of this proposal were filled after it was read', jsonb_array_length(v_bad)
      using errcode = 'P0006', detail = jsonb_build_object('cells', v_bad)::text;
  end if;

  -- One exception block around the whole loop — one subtransaction, not one
  -- per cell. It only adds WHICH allocation failed; the SQLSTATE and message
  -- are arrange_to_customer's own, so the screen maps them as it maps a
  -- single cell's.
  begin
    for v_index, v_pick_line_id, v_customer_id, v_quantity in
      select e.ord - 1,
             (e.elem ->> 'dailyPickProductId')::uuid,
             (e.elem ->> 'customerCompanyId')::uuid,
             (e.elem ->> 'quantityPallets')::numeric
      from jsonb_array_elements(p_allocations) with ordinality as e(elem, ord)
      order by e.ord
    loop
      select * into v_record
      from public.arrange_to_customer(v_pick_line_id, v_customer_id, v_quantity);
      -- arrange_to_customer UPDATES a record it finds. Under the locks above
      -- none can appear except through a direct write to the table (0010's
      -- backoffice write policy); a record this transaction did not create is
      -- refused rather than overwritten.
      if v_record.created_at is distinct from now() then
        raise exception 'CONFLICT: this cell was filled while the proposal was being saved' using errcode = 'P0006';
      end if;
      v_saved := v_saved + 1;
    end loop;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    raise exception using
      errcode = v_state,
      message = v_message,
      detail = jsonb_build_object(
        'index', v_index,
        'dailyPickProductId', v_pick_line_id,
        'customerCompanyId', v_customer_id,
        'quantityPallets', v_quantity)::text;
  end;

  return v_saved;
end;
$$;

comment on function public.save_arrangement_proposal(uuid, jsonb) is
  'Backoffice-only. Saves a whole arrangement proposal for one trading day in one transaction, all or nothing, through arrange_to_customer per allocation, and only into cells (pick line × customer) with no arrangement record yet. Returns the number of records created. Raises 42501 for a non-backoffice caller; P0002 for an unknown day or arrangement, or a pick line not on that day; P0007 if the arrangement is closed; P0008 for a malformed or repeated allocation; P0006 if a cell is already filled, or was marked forOrder and its order has gone (DETAIL lists every such cell); and whatever arrange_to_customer raises (P0002/P0008/P0009) with its SQLSTATE kept and DETAIL naming the allocation (index, dailyPickProductId, customerCompanyId, quantityPallets).';

-- SECURITY: ALLOWS signed-in users (`authenticated`) and the service role to
-- call it — the function itself then refuses everyone but backoffice, and
-- being SECURITY INVOKER it (and the arrange_to_customer it calls) writes
-- through the caller's own RLS, whose backoffice-only write policies on
-- daily_order_products (0017) and arrangement_records (0010) stand behind
-- that refusal. It needs no right the caller lacks, unlike save_pick_lines
-- (0039), which is why it is not a definer.
-- PROTECTS AGAINST anonymous callers reaching it at all (EXECUTE revoked from
-- public and anon, as in 0055, 0059, 0062 and 0067); a cell someone else
-- filled being overwritten (refused, never upserted); a cell meant for an
-- order becoming a push once that order is withdrawn (refused); a half-saved
-- day (one transaction); and a save landing inside a running close_arrangement
-- (the trading day is locked first).
revoke execute on function public.save_arrangement_proposal(uuid, jsonb) from public, anon;
grant execute on function public.save_arrangement_proposal(uuid, jsonb) to authenticated, service_role;
