-- Stock quantities can no longer be stored as NaN ("not a number").
--
-- Postgres numeric columns accept a special value, NaN, alongside ordinary
-- numbers, and the save functions turn the TEXT "NaN" into one: a grower's
-- save_pick_lines reads each quantity with `(line ->> 'palletsPicked')::numeric`.
-- Ori's own screens can never send it (JSON has no NaN; the browser sends
-- null instead, which is refused as "required"), but a hand-made request to
-- the API can. And NaN slips past every check these functions make, because
-- Postgres sorts NaN ABOVE every number: `NaN < 0` is false, so it is not
-- "negative", and `1000 > NaN` is false, so no order is "more than is left".
--
-- Reproduced on a copy of the database: one grower's save of "NaN" pallets
-- was accepted, and from then on a customer could order 1,000 pallets of
-- that product. Left alone it would also spread: the end-of-day close carries
-- leftover into the next day and NaN + anything is NaN. And the grower's own
-- screen shows the line as "NaN" and turns it into null when saving, so every
-- save of that grower's pick is refused ("pallets picked is required") until
-- someone types over that one field.
--
-- The rule is put on the columns themselves rather than into each save
-- function, so it covers every writer at once — the grower's and
-- distributor's saves, orders sent on a customer's behalf, arrangements,
-- direct backoffice edits, the Bubble importer — with no function body
-- copied or changed. Ordinary numbers, fractions included, are untouched.
-- (Infinity needs no rule: a numeric(10,2) column cannot hold it at all.)
--
-- The arrangement column already could not get a NaN through
-- create/update_arrangement_record (NaN trips their over-allocation check);
-- it gets the same rule anyway, so the guarantee does not rest on that
-- accident.
--
-- Adding a check makes Postgres read every existing row once and refuse the
-- whole migration if any already holds NaN — nothing is changed in that case,
-- and it would mean real bad data to look at first. Safe to run more than
-- once (each rule is dropped if present, then added).

-- STOCK: ALLOWS any ordinary number of pallets on a grower's pick line —
-- picked today, and carried in (or, once the day closes, left over).
-- PROTECTS AGAINST a NaN quantity, which every "is it negative / is there
-- enough" check lets through, so one NaN line would make its product
-- unlimited for customers and poison every later day it carries into.
alter table public.daily_pick_products
  drop constraint if exists daily_pick_products_pallets_picked_is_a_number,
  add constraint daily_pick_products_pallets_picked_is_a_number check (pallets_picked <> 'NaN'::numeric),
  drop constraint if exists daily_pick_products_leftover_pallets_is_a_number,
  add constraint daily_pick_products_leftover_pallets_is_a_number check (leftover_pallets <> 'NaN'::numeric);

-- STOCK: ALLOWS any ordinary number of pallets ordered. PROTECTS AGAINST a
-- NaN order line (possible through the backoffice "בשם לקוח" path, which
-- skips the customer's limit), which would make the product's total demand
-- NaN and so hide it from the out-of-stock and overbooking checks.
alter table public.daily_order_products
  drop constraint if exists daily_order_products_pallets_ordered_is_a_number,
  add constraint daily_order_products_pallets_ordered_is_a_number check (pallets_ordered <> 'NaN'::numeric);

-- STOCK: ALLOWS any ordinary number of pallets arranged to a customer.
-- PROTECTS AGAINST a NaN arrangement, which would make a pick line's
-- "already arranged" total NaN and with it the line's remaining stock.
alter table public.arrangement_records
  drop constraint if exists arrangement_records_quantity_pallets_is_a_number,
  add constraint arrangement_records_quantity_pallets_is_a_number check (quantity_pallets <> 'NaN'::numeric);

-- STOCK: ALLOWS any ordinary overbooking allowance, or none (null). PROTECTS
-- AGAINST a NaN allowance, which turns every customer's limit for the
-- product into NaN — the same "order without limit" hole as a NaN pick.
alter table public.product_varieties
  drop constraint if exists product_varieties_no_overbooking_is_a_number,
  add constraint product_varieties_no_overbooking_is_a_number check (no_overbooking <> 'NaN'::numeric);
