-- Dev-only WhatsApp send redirect, stored alongside the two toggles this
-- table already holds (whatsapp_enabled/close_arrangement_whatsapp_enabled)
-- rather than in a new generic "app settings" table — see docs/
-- SCHEMA_DECISIONS.md's R2 anti-pattern writeup for why this table stays
-- typed columns, not a key-value bucket. supabase/functions/whatsapp-dispatch
-- already selects from notification_settings on every invocation, so reading
-- this costs no extra round trip.
alter table "public"."notification_settings"
  add column "whatsapp_dev_override_phone" text;

comment on column "public"."notification_settings"."whatsapp_dev_override_phone" is
  'Dev-env-only (WHATSAPP_ENV != "live"): every WhatsApp send is redirected to this number instead of the real resolved recipient, so testing against real data can never reach an actual customer/grower. A dev send with this unset is refused, not sent to the real target. Ignored entirely in live env. Edited directly (Table Editor or SQL) — no redeploy needed to change it.';
