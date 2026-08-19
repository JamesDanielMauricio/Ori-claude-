-- Six remaining mainalert triggers (ids 3, 4, 6, 8, 10, 11 — see
-- docs/DATA_MIGRATION_PLAN.md § 3b) need two new notification_outbox
-- recipient categories this enum doesn't have yet: a backoffice-wide
-- broadcast (ids 3/6/10/11 — "notify the distributor") and a transporter
-- cc (id 8). ADD VALUE can't be used in the same transaction that
-- references the new value (same reason 0027 split the lifecycle_session_type
-- widening into its own migration) — this migration only widens the enum;
-- the functions that actually write these values land in the next one.
alter type "public"."notification_recipient_type" add value 'backoffice';
alter type "public"."notification_recipient_type" add value 'transporter';

comment on type "public"."notification_recipient_type" is
  'Purely descriptive — resolve_outbox_dispatch (0024) routes entirely off recipient_company_id, never branches on this column. backoffice/transporter added so an outbox row can self-document who it''s conceptually for, same as grower/customer already do.';
