-- A finding from inspecting the LIVE Bubble project's actual `session`
-- data (docs/DATA_MIGRATION_PLAN.md), not from the PRD text alone:
-- production has FIVE distinct session types —
-- "initiate day"/"open shop"/"close shop"/"end the day"/"update" — not
-- the two (close_shop, end_the_day) this schema's own comment (0009) and
-- reference/prd/lifecycle-invariants.md both stated as the source's only
-- audited transitions ("phases 1 and 2 are not audited in the source
-- either"). That claim was wrong, or true of an earlier version of the
-- Bubble app; ground truth from the live data overrides it.
--
-- This migration ONLY widens the enum so a faithful historical import
-- (packages/db/scripts/migrate-from-bubble.ts) has somewhere to put
-- these values without lossy remapping. It does NOT change what this
-- rebuild's own functions write going forward: initiate_business_day and
-- open_shop still write no lifecycle_sessions row (R6 — reproducing a
-- previously-undocumented audit gap is a real, separate product decision
-- for a future prompt to make deliberately, not something to slip in as
-- a side effect of a migration script). `historical_update` is a single
-- catch-all for the source's generic "update" session type, which
-- doesn't correspond to any one phase transition in this schema's model
-- at all.
alter type "public"."lifecycle_session_type" add value 'historical_initiate_day';
alter type "public"."lifecycle_session_type" add value 'historical_open_shop';
alter type "public"."lifecycle_session_type" add value 'historical_update';

comment on type "public"."lifecycle_session_type" is
  'close_shop and end_the_day are the only values this rebuild''s own functions ever write (0011/0015/0022). The historical_* values exist solely so the Bubble data migration can preserve the source''s full five-type audit trail (see docs/DATA_MIGRATION_PLAN.md) without lossy remapping — new code must never write them.';
