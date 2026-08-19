-- Grower picking input (R1/R6): the fields the grower's daily picking
-- screen and the leftover-computation function need, which Prompt 5's
-- lifecycle-focused schema didn't yet carry.
alter table "public"."daily_pick_products"
  add column "pickup_time" time,
  add column "comment" text,
  add column "leftover_pallets" numeric(10, 2);

comment on column "public"."daily_pick_products"."pickup_time" is
  'Optional per-line override of the grower company''s default_pickup_time. Null means "use the default".';

comment on column "public"."daily_pick_products"."leftover_pallets" is
  'pallets_picked minus what arrangement_records committed for this line, computed once by close_out_pick_leftovers when the pick closes. Collapses the source''s two near-identical leftover fields into one.';

alter table "public"."daily_picks"
  add column "reminder_sent_at" timestamp with time zone;

comment on column "public"."daily_picks"."reminder_sent_at" is
  'Set by the distributor''s "send a reminder" action on the Grower Inventory Status screen — a real persisted signal, not a WhatsApp dispatch (that integration is a later module).';
