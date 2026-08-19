-- Reference-data module (R6): fleshes out the placeholder `companies` and
-- `product_varieties` tables from the auth-module prompts into the real
-- aggregates the PRD describes, plus the two join tables the five
-- Backoffice management screens need. See docs/SCHEMA_DECISIONS.md.

-- 1. New enums.
create type "public"."company_type" as enum ('backoffice', 'grower', 'customer', 'transporter');
create type "public"."company_status" as enum ('active', 'inactive');
create type "public"."pack_type" as enum ('pallets', 'crates');

-- 2. companies — add the fields the PRD's Company entity actually has.
--    `type` has no default: every existing row must be explicitly
--    classified before this lands, so it's added nullable-then-backfilled
--    rather than given a default that could hide a wrong guess. There are
--    no rows yet in any real environment this migrates (backfill is a
--    formality here, not a live-data concern).
alter table "public"."companies"
  add column "type" "public"."company_type",
  add column "status" "public"."company_status" not null default 'active',
  add column "default_pickup_time" time,
  add column "can_see_product_prices" boolean,
  add column "whatsapp_group_id" text;

update "public"."companies" set "type" = 'backoffice' where "type" is null;

alter table "public"."companies" alter column "type" set not null;

-- 3. product_families — the catalog's parent grouping (`product_library`
--    in the PRD).
create table "public"."product_families" (
  "id" uuid primary key default gen_random_uuid(),
  "name" text not null,
  "category" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

-- 4. product_varieties — add the full catalog field set. Existing rows
--    (the placeholder table) have no family yet, so a temporary
--    "Uncategorized" family backfills the NOT NULL FK the same way `type`
--    was backfilled above.
insert into "public"."product_families" ("name")
  select 'Uncategorized'
  where exists (select 1 from "public"."product_varieties")
  and not exists (select 1 from "public"."product_families" where "name" = 'Uncategorized');

alter table "public"."product_varieties"
  add column "family_id" uuid,
  add column "sizes" text,
  add column "pack_type" "public"."pack_type",
  add column "price" numeric(10, 2),
  add column "price_range_from" numeric(10, 2),
  add column "price_range_to" numeric(10, 2),
  add column "price_type" text,
  add column "no_overbooking" numeric(10, 2) not null default 0,
  add column "highlight_price_fluctuations" boolean not null default false,
  add column "is_seasonal_available" boolean not null default true,
  add column "version" integer not null default 1;

update "public"."product_varieties" pv
  set "family_id" = (select "id" from "public"."product_families" where "name" = 'Uncategorized')
  where "family_id" is null;

alter table "public"."product_varieties"
  alter column "family_id" set not null,
  add constraint "product_varieties_family_id_product_families_id_fk"
    foreign key ("family_id") references "public"."product_families"("id");

-- 5. grower_products — a grower company's in-season variety selection
--    (the PRD's `products_in_season_list`), as a real join table.
create table "public"."grower_products" (
  "company_id" uuid not null references "public"."companies"("id") on delete cascade,
  "product_variety_id" uuid not null references "public"."product_varieties"("id") on delete cascade,
  "created_at" timestamp with time zone not null default now(),
  primary key ("company_id", "product_variety_id")
);

-- 6. product_customer_caps — the new per-customer pallet cap this prompt
--    introduces (not in the source PRD's field list — see
--    product-customer-cap.ts).
create table "public"."product_customer_caps" (
  "product_variety_id" uuid not null references "public"."product_varieties"("id") on delete cascade,
  "customer_company_id" uuid not null references "public"."companies"("id") on delete cascade,
  "pallet_cap" integer not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  primary key ("product_variety_id", "customer_company_id")
);
