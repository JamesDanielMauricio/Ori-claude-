-- Lifecycle module (R2/R7): the four-phase daily trading lifecycle
-- (Initiate Business Day -> Open Shop -> Close Shop -> Close Arrangement)
-- as a real state machine anchored on `trading_days`, replacing the
-- source's App Settings singleton and its "active_X" pointer fields
-- entirely. See docs/SCHEMA_DECISIONS.md for the full design rationale.

-- 1. New enums.
create type "public"."trading_day_phase" as enum ('initiated', 'shop_open', 'shop_closed', 'closed');
create type "public"."daily_shop_status" as enum ('open', 'closed');
create type "public"."daily_arrangement_status" as enum ('open', 'closed');
create type "public"."daily_pick_status" as enum ('draft', 'submitted', 'closed');
create type "public"."daily_order_status" as enum ('open', 'closed');
create type "public"."lifecycle_session_type" as enum ('close_shop', 'end_the_day');

-- 2. trading_days — the lifecycle anchor.
create table "public"."trading_days" (
  "id" uuid primary key default gen_random_uuid(),
  "trade_date" date not null,
  "phase" "public"."trading_day_phase" not null default 'initiated',
  "initiated_by" uuid not null references "public"."profiles"("user_id"),
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

-- Lifecycle Invariant 1, and the concurrency guard on Initiate (R7): at
-- most one trading day may be in a non-terminal phase at any time. A
-- partial unique index on a constant expression is the standard Postgres
-- "at most one row matching this predicate" constraint — two concurrent
-- `initiate_business_day` calls race on this index; exactly one commits,
-- the other gets a real unique-violation the function turns into a clear
-- error (see 0011). This is the fix for the source's documented gap
-- (initiate-business-day-phase-1.md: "no guard against being invoked
-- while a previous day is still active").
create unique index "trading_days_single_open_idx" on "public"."trading_days" ((true))
  where "phase" <> 'closed';

-- 3. daily_shops — one per trading day. `unique` on trading_day_id is
--    both Invariant 1's shop-level shape and the concurrency guard on
--    Open Shop (two simultaneous `open_shop` calls race here).
create table "public"."daily_shops" (
  "id" uuid primary key default gen_random_uuid(),
  "trading_day_id" uuid not null unique references "public"."trading_days"("id"),
  "status" "public"."daily_shop_status" not null default 'open',
  "can_see_prices" boolean not null default true,
  "opened_by" uuid not null references "public"."profiles"("user_id"),
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

-- 4. daily_arrangements — one per trading day, created at Phase 1,
--    closed (terminal) at Phase 4.
create table "public"."daily_arrangements" (
  "id" uuid primary key default gen_random_uuid(),
  "trading_day_id" uuid not null unique references "public"."trading_days"("id"),
  "status" "public"."daily_arrangement_status" not null default 'open',
  "created_at" timestamp with time zone not null default now(),
  "closed_at" timestamp with time zone
);

-- 5. daily_picks — one per (trading day, grower company), bootstrapped by
--    initiate_business_day.
create table "public"."daily_picks" (
  "id" uuid primary key default gen_random_uuid(),
  "trading_day_id" uuid not null references "public"."trading_days"("id"),
  "grower_company_id" uuid not null references "public"."companies"("id"),
  "status" "public"."daily_pick_status" not null default 'draft',
  "submitted_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  unique ("trading_day_id", "grower_company_id")
);

-- 6. daily_pick_products — a grower's per-variety line for the day,
--    bootstrapped from grower_products. `pallets_picked` is the field the
--    arrangement-edit floor check guards (see 0011's
--    `update_pick_product_pallets`).
create table "public"."daily_pick_products" (
  "id" uuid primary key default gen_random_uuid(),
  "daily_pick_id" uuid not null references "public"."daily_picks"("id") on delete cascade,
  "product_variety_id" uuid not null references "public"."product_varieties"("id"),
  "pallets_picked" numeric(10, 2) not null default 0,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  unique ("daily_pick_id", "product_variety_id")
);

-- 7. daily_orders — a customer's order header for the day, bootstrapped
--    by open_shop. Full order-line entry is the customer module's scope.
create table "public"."daily_orders" (
  "id" uuid primary key default gen_random_uuid(),
  "trading_day_id" uuid not null references "public"."trading_days"("id"),
  "customer_company_id" uuid not null references "public"."companies"("id"),
  "status" "public"."daily_order_status" not null default 'open',
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  unique ("trading_day_id", "customer_company_id")
);

-- 8. arrangement_records — a grower-supply-to-customer-demand match.
--    Creating these is a later prompt's scope (the "New Arrangement
--    Wizard"); this table exists now so the floor check has something
--    real to sum against.
create table "public"."arrangement_records" (
  "id" uuid primary key default gen_random_uuid(),
  "daily_arrangement_id" uuid not null references "public"."daily_arrangements"("id"),
  "daily_pick_product_id" uuid not null references "public"."daily_pick_products"("id"),
  "customer_company_id" uuid not null references "public"."companies"("id"),
  "quantity_pallets" numeric(10, 2) not null,
  "price" numeric(10, 2),
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

-- 9. lifecycle_sessions — append-only audit trail for phase-3/phase-4
--    transitions (the PRD's "Session" entity). Written as the LAST
--    statement of close_shop/close_arrangement (see 0011) so a row here
--    means "this transition's side effects fully committed" uniformly for
--    both, unlike the source's inconsistent logging order (R6).
create table "public"."lifecycle_sessions" (
  "id" uuid primary key default gen_random_uuid(),
  "trading_day_id" uuid not null references "public"."trading_days"("id"),
  "session_type" "public"."lifecycle_session_type" not null,
  "performed_by" uuid not null references "public"."profiles"("user_id"),
  "metadata" jsonb not null default '{}',
  "created_at" timestamp with time zone not null default now()
);
