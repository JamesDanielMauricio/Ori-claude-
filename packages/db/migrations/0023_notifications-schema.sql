-- Notifications module (R2/R4): the in-app Alerts delivery log, the
-- admin-configurable Alert Types bank, the named notification_templates
-- lookup WhatsApp dispatch pulls by key (the source's `main alert` —
-- verified NOT redundant with Alert Types, see docs/SCHEMA_DECISIONS.md),
-- a genuine two-toggle settings singleton, and the retry/observability
-- columns notification_outbox (Prompt 8) was deliberately left without.

alter table "public"."profiles" add column "phone_number" text;

comment on column "public"."profiles"."phone_number" is
  'Optional. Source of the individual-WhatsApp-dispatch batch (a company with no whatsapp_group_id falls back to messaging each user directly, 972-prefixed) — a user with no phone on file is simply unreachable by that batch, not an error.';

create type "public"."notification_channel" as enum ('whatsapp');

-- alert_types — admin-configurable bank of in-app notification "kinds".
-- Structured navigation target (app_screen + url_parameter), no
-- placeholder-substitution field: an Alert renders main_text alongside
-- its own typed number_for_display/full_name_for_display, never a
-- find/replace target. See docs/SCHEMA_DECISIONS.md.
create table "public"."alert_types" (
  "id" uuid primary key default gen_random_uuid(),
  "main_text" text not null,
  "second_line_of_text" text,
  "send_as_whatsapp_default" boolean not null default false,
  "send_as_notification_default" boolean not null default true,
  "app_screen" text not null,
  "url_parameter" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

comment on table "public"."alert_types" is
  'Admin-configurable bank of in-app notification kinds (PRD "Alert Types"). Feeds alerts.alert_type_id — never referenced by WhatsApp dispatch, which uses notification_templates instead.';

alter table public.alert_types enable row level security;
alter table public.alert_types force row level security;

grant select, insert, update, delete on public.alert_types to authenticated;

create policy "alert_types_backoffice" on public.alert_types
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- Seeded with fixed, well-known ids so build_arrangement_alerts (0024) can
-- reference them by id directly rather than a second by-key lookup — these
-- two rows are the in-app counterpart of the notification_templates rows
-- seeded below, one per close_arrangement audience.
insert into public.alert_types (id, main_text, second_line_of_text, send_as_whatsapp_default, send_as_notification_default, app_screen, url_parameter) values
  (
    '00000000-0000-0000-0000-000000000001',
    'הסידור היומי נסגר',
    'לחצו לצפייה בהזמנה שסודרה עבורכם',
    true,
    true,
    '/customer/history',
    null
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'הסידור היומי נסגר',
    'לחצו לצפייה במה שנמכר מהסחורה שלכם',
    true,
    true,
    '/grower/picks',
    null
  );

-- notification_templates — the source's `main alert`: a small, stable set
-- of named WhatsApp message templates referenced by key directly from
-- workflow code, with inline %TOKEN% placeholder substitution. See
-- docs/SCHEMA_DECISIONS.md for why this stays a separate table from
-- alert_types.
create table "public"."notification_templates" (
  "id" uuid primary key default gen_random_uuid(),
  "template_key" text not null unique,
  "channel" "public"."notification_channel" not null default 'whatsapp',
  "title" text,
  "content" text not null,
  "link" text,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

comment on table "public"."notification_templates" is
  'Named outbound-message templates (PRD "main alert"), looked up by template_key at dispatch time. content carries %FIRST_NAME%/%ORDER_DETAILS%/%CURRENT_OPEN_BUSINESS_DAY%/%NL% placeholders, substituted per-recipient by resolve_outbox_dispatch (0024).';

alter table public.notification_templates enable row level security;
alter table public.notification_templates force row level security;

grant select, insert, update, delete on public.notification_templates to authenticated;

create policy "notification_templates_backoffice" on public.notification_templates
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

insert into public.notification_templates (template_key, channel, title, content, link) values
  (
    'close_arrangement_customer',
    'whatsapp',
    'הסידור היומי נסגר',
    '%FIRST_NAME% שלום,%NL%הסידור עבור יום המסחר %CURRENT_OPEN_BUSINESS_DAY% נסגר. הנה מה שסודר עבורכם:%NL%%NL%%ORDER_DETAILS%',
    null
  ),
  (
    'close_arrangement_grower',
    'whatsapp',
    'הסידור היומי נסגר',
    '%FIRST_NAME% שלום,%NL%הסידור עבור יום המסחר %CURRENT_OPEN_BUSINESS_DAY% נסגר. הנה מה שנמכר מהסחורה שלכם:%NL%%NL%%ORDER_DETAILS%',
    null
  );

-- notification_settings — a genuine two-boolean singleton, not the R2
-- "app settings" anti-pattern (see the schema file's own comment). The
-- `id boolean primary key default true, check(id)` shape makes a second
-- row structurally impossible, not just conventionally avoided.
create table "public"."notification_settings" (
  "id" boolean primary key default true,
  "whatsapp_enabled" boolean not null default false,
  "close_arrangement_whatsapp_enabled" boolean not null default false,
  constraint "notification_settings_singleton" check ("id")
);

comment on table "public"."notification_settings" is
  'Singleton. whatsapp_enabled is the global outbound-WhatsApp toggle; close_arrangement_whatsapp_enabled additionally gates the close-arrangement dispatch specifically — both must be true for that dispatch to send (whatsapp-messaging.md).';

insert into public.notification_settings (id) values (true);

alter table public.notification_settings enable row level security;
alter table public.notification_settings force row level security;

grant select, update on public.notification_settings to authenticated;

create policy "notification_settings_select_backoffice" on public.notification_settings
  for select
  to authenticated
  using (public.current_role() = 'backoffice');

create policy "notification_settings_update_backoffice" on public.notification_settings
  for update
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- alerts — the in-app delivery log. The privacy gap this task explicitly
-- calls out (source: no privacy rule ever set on Alerts, defaulting to
-- "everyone") is closed here from the start: intended_for_user_id =
-- auth.uid() on both the select and the mark-as-read update, and no
-- insert/delete policy for `authenticated` at all — every row is written
-- by create_alert (SECURITY DEFINER, 0024), matching
-- order_submission_logs' closed-to-raw-writes shape.
create table "public"."alerts" (
  "id" uuid primary key default gen_random_uuid(),
  "intended_for_user_id" uuid not null references "public"."profiles"("user_id") on delete cascade,
  "alert_type_id" uuid not null references "public"."alert_types"("id"),
  "read" boolean not null default false,
  "display_record_id" uuid,
  "number_for_display" numeric(10, 2),
  "full_name_for_display" text,
  "send_as_whatsapp" boolean not null,
  "send_as_notification" boolean not null,
  "created_at" timestamp with time zone not null default now()
);

comment on table "public"."alerts" is
  'One row per notification actually delivered to a specific user (PRD "Alerts"). Always user-scoped, independent of whether the same event also wrote a company-scoped notification_outbox row for WhatsApp.';

create index "alerts_intended_for_user_id_idx" on "public"."alerts" ("intended_for_user_id");

alter table public.alerts enable row level security;
alter table public.alerts force row level security;

grant select, update on public.alerts to authenticated;

create policy "alerts_select_own" on public.alerts
  for select
  to authenticated
  using (intended_for_user_id = (select auth.uid()));

create policy "alerts_update_own" on public.alerts
  for update
  to authenticated
  using (intended_for_user_id = (select auth.uid()))
  with check (intended_for_user_id = (select auth.uid()));

-- notification_outbox (Prompt 8) — add the retry/observability columns
-- deliberately deferred to this prompt, plus template_key so
-- resolve_outbox_dispatch (0024) knows which notification_templates row
-- to pull. Zero real rows exist yet (only ever test fixtures, all torn
-- down) — safe to add template_key NOT NULL directly, no backfill.
alter table "public"."notification_outbox"
  add column "template_key" text not null,
  add column "attempt_count" integer not null default 0,
  add column "last_error" text,
  add column "last_attempted_at" timestamp with time zone;

comment on column "public"."notification_outbox"."template_key" is
  'Which notification_templates.template_key to compose this row''s message from. Not a foreign key on purpose — a missing template surfaces as a clear NOT_FOUND at dispatch time, not a constraint blocking the close_arrangement transaction that wrote this row.';

comment on column "public"."notification_outbox"."attempt_count" is
  'Incremented by the drain job on each failed send attempt for this row — the real retry/observability this module replaces the source''s single hardcoded-email dead-letter with.';
