-- Bubble -> Postgres data migration tooling (docs/DATA_MIGRATION_PLAN.md).
-- These two tables exist purely to support the one-time ETL run
-- (packages/db/scripts/migrate-from-bubble.ts) — they are never read by
-- application code, never exposed to `authenticated`/`anon` (RLS enabled
-- and forced, with zero policies — a real trusted-connection/service-role
-- write is the only way in or out, the same "the database enforces it"
-- posture as every RLS-governed table, just with the door fully closed
-- instead of self-scoped), and are not part of packages/db/src/schema —
-- they're migration bookkeeping, not the application's data model.
--
-- Kept permanently after the migration completes, not dropped — a small,
-- durable audit trail of "this new row came from that Bubble record" is
-- more useful than reclaiming a few MB, especially for reconciling any
-- post-cutover discrepancy report against the source.

create table "public"."_bubble_migration_id_map" (
  "bubble_id" text primary key,
  "entity_type" text not null,
  "new_id" uuid not null,
  "migrated_at" timestamp with time zone not null default now()
);

comment on table "public"."_bubble_migration_id_map" is
  'One row per Bubble record migrated into this schema: entity_type (e.g. "company", "dailypick") + the Bubble _id it came from, mapped to the new Postgres uuid. Lets the ETL script (and any later reconciliation) resolve a foreign key across the migration without re-deriving it.';

create index "_bubble_migration_id_map_entity_type_idx" on "public"."_bubble_migration_id_map" ("entity_type");
create index "_bubble_migration_id_map_new_id_idx" on "public"."_bubble_migration_id_map" ("new_id");

alter table public._bubble_migration_id_map enable row level security;
alter table public._bubble_migration_id_map force row level security;
-- Deliberately no grants, no policies — inaccessible to `authenticated`/
-- `anon` entirely. Only a direct/service-role connection (RLS bypass) can
-- read or write this table, matching how every test-helper file in this
-- project already writes fixtures directly.

create table "public"."_bubble_migration_log" (
  "id" uuid primary key default gen_random_uuid(),
  "entity_type" text not null,
  "bubble_id" text,
  "severity" text not null,
  "message" text not null,
  "created_at" timestamp with time zone not null default now(),
  constraint "_bubble_migration_log_severity_check" check ("severity" in ('info', 'warning', 'error'))
);

comment on table "public"."_bubble_migration_log" is
  'Per-record notes the ETL script emits for anything it could not migrate cleanly (a temp-record pick line skipped by design, an arrangement record whose order-line match was ambiguous, a session type outside the two the rebuild''s own code ever writes, ...) — a working list for whoever reviews the migration before cutover, not a silent skip.';

create index "_bubble_migration_log_severity_idx" on "public"."_bubble_migration_log" ("severity");

alter table public._bubble_migration_log enable row level security;
alter table public._bubble_migration_log force row level security;
