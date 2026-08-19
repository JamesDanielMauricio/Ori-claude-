-- Customer ordering module (R1/R2/R6): corrects 0009's placeholder
-- daily_order_status enum to the PRD's real reachable states, adds the
-- line-item table the source's dash-packed save_order_line workflow wrote
-- to, and a new order_submission_logs table for the v1.3 audit-log
-- feature. No `Deleted` soft-delete flag, no `no_of_pallets_before`
-- history list, no `processing`/`actively_editing` fields — see
-- docs/SCHEMA_DECISIONS.md for why each was dropped.

-- 0009 bootstrapped daily_orders with a placeholder ("open"/"closed")
-- status, deferring the real enum to this module. No row has ever been
-- written with "closed" (only open_shop inserts, always at the default
-- "open"; nothing else writes daily_orders.status yet), so renaming in
-- place is safe. "Submitted" is the PRD's actual second reachable state —
-- the three later states (Scheduled/Out for delivery/Received) are
-- aspirational placeholders no workflow ever assigns (code is the anchor).
alter type "public"."daily_order_status" rename value 'closed' to 'submitted';

alter table "public"."daily_orders"
  add column "submitted_at" timestamp with time zone;

comment on column "public"."daily_orders"."submitted_at" is
  'Stamped by submit_order on every submission (not just the first) — see order_submission_logs for the full per-submission history.';

-- daily_order_products — a customer's per-variety order line. Upserted and
-- pruned by submit_order (see 0018), mirroring bootstrap_grower_pick's
-- shape. A row only ever exists at pallets_ordered > 0 — submit_order
-- deletes a line rather than writing zero.
create table "public"."daily_order_products" (
  "id" uuid primary key default gen_random_uuid(),
  "daily_order_id" uuid not null references "public"."daily_orders"("id") on delete cascade,
  "product_variety_id" uuid not null references "public"."product_varieties"("id"),
  "pallets_ordered" numeric(10, 2) not null default 0,
  "comment" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  unique ("daily_order_id", "product_variety_id")
);

-- Same shape as daily_picks/daily_pick_products: a customer reads their
-- own company's lines; backoffice reads/writes all. Customer writes go
-- through submit_order (security definer) only — there is no direct
-- customer write policy here, matching daily_pick_products.
alter table public.daily_order_products enable row level security;
alter table public.daily_order_products force row level security;

grant select, insert, update, delete on public.daily_order_products to authenticated;

create policy "daily_order_products_select_own" on public.daily_order_products
  for select
  to authenticated
  using (
    exists (
      select 1 from public.daily_orders do2
      where do2.id = daily_order_products.daily_order_id
        and do2.customer_company_id = public.current_company_id()
    )
  );

create policy "daily_order_products_select_backoffice" on public.daily_order_products
  for select
  to authenticated
  using (public.current_role() = 'backoffice');

create policy "daily_order_products_write_backoffice" on public.daily_order_products
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- order_submission_logs — v1.3's new audit-log feature (kept as-is, R6):
-- one append-only row per submission event, written only by submit_order.
create table "public"."order_submission_logs" (
  "id" uuid primary key default gen_random_uuid(),
  "daily_order_id" uuid not null references "public"."daily_orders"("id") on delete cascade,
  "submitted_by" uuid not null references "public"."profiles"("user_id"),
  "snapshot" jsonb not null,
  "created_at" timestamp with time zone not null default now()
);

alter table public.order_submission_logs enable row level security;
alter table public.order_submission_logs force row level security;

-- Append-only, like lifecycle_sessions: no update/delete policy for any
-- role, including backoffice.
grant select, insert on public.order_submission_logs to authenticated;

create policy "order_submission_logs_select_own" on public.order_submission_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.daily_orders do2
      where do2.id = order_submission_logs.daily_order_id
        and do2.customer_company_id = public.current_company_id()
    )
  );

create policy "order_submission_logs_select_backoffice" on public.order_submission_logs
  for select
  to authenticated
  using (public.current_role() = 'backoffice');
