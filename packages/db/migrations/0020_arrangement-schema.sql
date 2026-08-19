-- Arrangement module (R1/R2/R4): arrangement_records now pairs a specific
-- pick line with a specific order line (the source only linked to the
-- customer COMPANY, never a specific daily_order_product — a real loss of
-- precision this schema doesn't repeat), and a new notification_outbox
-- table gives close_arrangement's WhatsApp step something durable to
-- write to instead of an outbound HTTP call inside its own transaction.

-- arrangement_records currently has zero real rows (only ever test
-- fixtures, all torn down) — safe to add a NOT NULL column directly, no
-- backfill needed.
alter table "public"."arrangement_records"
  add column "daily_order_product_id" uuid not null
    references "public"."daily_order_products"("id") on delete cascade,
  add column "price_type" text;

comment on column "public"."arrangement_records"."daily_order_product_id" is
  'The specific customer order line this quantity was matched against — not just the customer company (the source''s dailyarrangementrecords never linked to a specific order line, only the company).';

comment on column "public"."arrangement_records"."price_type" is
  'Snapshot of which price type produced `price` — populated by close_arrangement''s price-population step, or by an explicit override at create/update time.';

create index "arrangement_records_daily_order_product_id_idx"
  on "public"."arrangement_records" ("daily_order_product_id");

-- notification_outbox — R4's external-system carve-out: close_arrangement
-- writes one row per recipient here, in the same transaction as the
-- status/price changes. No network call, so it commits or rolls back with
-- everything else. A later prompt's Edge Function / scheduled job drains
-- this table and performs the actual WhatsApp dispatch after the
-- transaction has already committed.
create type "public"."notification_recipient_type" as enum ('grower', 'customer');

create table "public"."notification_outbox" (
  "id" uuid primary key default gen_random_uuid(),
  "trading_day_id" uuid not null references "public"."trading_days"("id") on delete cascade,
  "recipient_type" "public"."notification_recipient_type" not null,
  "recipient_company_id" uuid not null references "public"."companies"("id"),
  "payload" jsonb not null,
  "created_at" timestamp with time zone not null default now(),
  "sent_at" timestamp with time zone
);

comment on table "public"."notification_outbox" is
  'Durable queue for the WhatsApp dispatch close_arrangement triggers (Actions 7/8 of the source''s close_arrangement workflow). Written transactionally by close_arrangement; drained by a later prompt''s Edge Function, which sets sent_at on success. No retry-count/error columns — that''s the drain job''s own concern.';

-- Backoffice-only, matching every other lifecycle/arrangement table —
-- the drain job (a later prompt) runs with the service-role key, which
-- bypasses RLS entirely, so no policy is needed for it specifically.
alter table public.notification_outbox enable row level security;
alter table public.notification_outbox force row level security;

grant select, insert, update, delete on public.notification_outbox to authenticated;

create policy "notification_outbox_backoffice" on public.notification_outbox
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');
