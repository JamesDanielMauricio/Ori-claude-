import { pgEnum } from "drizzle-orm/pg-core";

// Admin and Distributor are, by PRD confirmation, permission-identical — one
// role ("backoffice"), not two duplicated ones. Transporter is deliberately
// excluded here: it never signs in, so it never gets a Supabase Auth
// account and therefore never gets a `profiles` row — see
// docs/SCHEMA_DECISIONS.md.
export const userRoleEnum = pgEnum("user_role", ["backoffice", "grower", "customer"]);

// Company Type, unlike User Role, DOES include transporter — a Transporter
// Company is a real reference-data row a Distributor manages (name, WhatsApp
// group) even though no User ever authenticates as one. Values otherwise
// mirror user_role's backoffice/grower/customer collapse (see
// docs/SCHEMA_DECISIONS.md).
export const companyTypeEnum = pgEnum("company_type", [
  "backoffice",
  "grower",
  "customer",
  "transporter",
]);

// Two states, per the PRD's Company Status state machine — gates
// participation in the trading cycle (bootstraps/shop windows skip
// inactive companies). Not a soft-delete flag: history stays intact either
// way.
export const companyStatusEnum = pgEnum("company_status", ["active", "inactive"]);

// The PRD documents exactly two Pack Type values ("Pallets or Crates") —
// unlike Price Type or Product Category below, this one IS fully
// enumerated, so it's a real Postgres enum rather than free text.
export const packTypeEnum = pgEnum("pack_type", ["pallets", "crates"]);

// The single canonical phase of a trading day — replaces the source's four
// separate, partially-redundant flags (`day_status`, `shop_status`,
// `visible_buttons`, `arrangement_status` all layered on one App Settings
// singleton) with one column that is the actual source of truth. Which
// lifecycle button a UI should show next is a pure function of this value
// (a later prompt's concern), not a persisted field of its own — R2.
// Four values because there are exactly four phases, forward-only:
// initiated (phase 1) → shop_open (phase 2) → shop_closed (phase 3) →
// closed (phase 4, terminal).
export const tradingDayPhaseEnum = pgEnum("trading_day_phase", [
  "initiated",
  "shop_open",
  "shop_closed",
  "closed",
]);

// A Daily Shop's own status (PRD: Open/Closed) — distinct from the day's
// overall phase even though they move in lockstep in practice, because
// it's a real property of the shop record itself, not a derived view.
export const dailyShopStatusEnum = pgEnum("daily_shop_status", ["open", "closed"]);

// A Daily Arrangement's own status (PRD: Open/Closed, terminal at close).
export const dailyArrangementStatusEnum = pgEnum("daily_arrangement_status", [
  "open",
  "closed",
]);

// A Daily Pick's three-state machine (PRD: Draft → Submitted → Closed),
// forward-only, no reverse transitions in any UI or function this module
// exposes.
export const dailyPickStatusEnum = pgEnum("daily_pick_status", [
  "draft",
  "submitted",
  "closed",
]);

// A Daily Order's real reachable states — per the PRD's own state-machine
// doc, the option set nominally lists five values (Open / Submitted /
// Scheduled / Out for delivery / Received), but only Open and Submitted
// are ever assigned by any workflow; the other three are aspirational
// placeholders never reached in practice (code is the anchor — R6). "The
// day's arrangement is finalized for this order" is derived from
// arrangement_records' existence, not a third status value here — adding
// a `closed`/`scheduled` value the customer module never assigns would
// just reintroduce the dead-state problem this enum already avoided once
// (see the customer module's migration for the value fixed here).
export const dailyOrderStatusEnum = pgEnum("daily_order_status", ["open", "submitted"]);

// close_shop and end_the_day are the only two values this rebuild's own
// functions ever write (0011/0015/0022). The historical_* values
// (0027) exist solely so the Bubble data migration can preserve the
// source's full five-session-type audit trail (initiate day/open shop/
// close shop/end the day/update — confirmed against the LIVE project's
// actual data, contradicting this file's own earlier claim that phases 1
// and 2 go unaudited in the source) without lossy remapping — see
// docs/DATA_MIGRATION_PLAN.md. New code must never write them.
export const lifecycleSessionTypeEnum = pgEnum("lifecycle_session_type", [
  "close_shop",
  "end_the_day",
  "historical_initiate_day",
  "historical_open_shop",
  "historical_update",
]);

// Which side of a trading relationship a notification_outbox row targets
// — the source's own "company batch" vs "user batch" WhatsApp dispatch
// split (close-arrangement-phase-4-terminal.md's actions 7/8) collapses
// to this one column plus recipient_company_id; a later prompt's drain
// job resolves the actual phone/group_id to message at send time, not
// this table. Purely descriptive — resolve_outbox_dispatch (0024) never
// branches on it, only on recipient_company_id. backoffice/transporter
// added in 0030 for the remaining mainalert triggers (ids 3/6/8/10/11):
// backoffice is a role, not a company, so "notify backoffice" means one
// outbox row per active backoffice-typed company (see
// enqueue_backoffice_notification, 0031) — transporter is a real cc on
// the arrangement-finalization message (id 8).
export const notificationRecipientTypeEnum = pgEnum("notification_recipient_type", [
  "grower",
  "customer",
  "backoffice",
  "transporter",
]);

// The channel a notification_templates row targets — the source's own
// `main alert` entity has a "notification type" option field for exactly
// this (see docs/SCHEMA_DECISIONS.md's Alert Types vs main alert
// analysis). One value today (WhatsApp is the only outbound channel this
// platform implements); a real enum rather than free text because
// resolve_outbox_dispatch branches on it, the same reasoning pack_type
// got a real enum for.
export const notificationChannelEnum = pgEnum("notification_channel", ["whatsapp"]);
