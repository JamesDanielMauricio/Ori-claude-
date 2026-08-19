-- A trading day's shop/arrangement/picks/orders are genuinely owned by
-- it — reachable by FK the whole time it's open (Invariant 3) — so
-- deleting the day should cascade to all of them, the same way
-- daily_pick_products already cascades from daily_picks (0009). 0009
-- left these as the Postgres default (NO ACTION), which was an oversight,
-- not a deliberate "trading days are protected from deletion" choice —
-- production code never deletes a trading_days row either way (days are
-- closed, not removed), so this only changes behavior for an explicit
-- administrative/test delete, where cascading is what "owned by" should
-- mean.
alter table "public"."daily_shops"
  drop constraint "daily_shops_trading_day_id_fkey",
  add constraint "daily_shops_trading_day_id_fkey"
    foreign key ("trading_day_id") references "public"."trading_days"("id") on delete cascade;

alter table "public"."daily_arrangements"
  drop constraint "daily_arrangements_trading_day_id_fkey",
  add constraint "daily_arrangements_trading_day_id_fkey"
    foreign key ("trading_day_id") references "public"."trading_days"("id") on delete cascade;

alter table "public"."daily_picks"
  drop constraint "daily_picks_trading_day_id_fkey",
  add constraint "daily_picks_trading_day_id_fkey"
    foreign key ("trading_day_id") references "public"."trading_days"("id") on delete cascade;

alter table "public"."daily_orders"
  drop constraint "daily_orders_trading_day_id_fkey",
  add constraint "daily_orders_trading_day_id_fkey"
    foreign key ("trading_day_id") references "public"."trading_days"("id") on delete cascade;

alter table "public"."lifecycle_sessions"
  drop constraint "lifecycle_sessions_trading_day_id_fkey",
  add constraint "lifecycle_sessions_trading_day_id_fkey"
    foreign key ("trading_day_id") references "public"."trading_days"("id") on delete cascade;

-- arrangement_records' two structural FKs (not customer_company_id, which
-- should stay protective — you shouldn't be able to delete a Company out
-- from under a real arrangement record) cascade too, so a cascading
-- delete from trading_days reaches all the way down without a manual
-- foreign-key-order dance in test cleanup.
alter table "public"."arrangement_records"
  drop constraint "arrangement_records_daily_arrangement_id_fkey",
  add constraint "arrangement_records_daily_arrangement_id_fkey"
    foreign key ("daily_arrangement_id") references "public"."daily_arrangements"("id") on delete cascade;

alter table "public"."arrangement_records"
  drop constraint "arrangement_records_daily_pick_product_id_fkey",
  add constraint "arrangement_records_daily_pick_product_id_fkey"
    foreign key ("daily_pick_product_id") references "public"."daily_pick_products"("id") on delete cascade;
