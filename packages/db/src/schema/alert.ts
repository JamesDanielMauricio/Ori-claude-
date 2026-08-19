import { boolean, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { alertTypes } from "./alert-type";
import { profiles } from "./profile";

// The in-app delivery log (PRD's "Alerts" entity) — one row per
// notification actually delivered to a specific user, independent of
// whether it also went out over WhatsApp (notification_outbox is the
// separate, company-scoped WhatsApp queue; this table is always
// user-scoped, since read/unread state is inherently per-recipient).
//
// Privacy (the explicit point of this table, per the task): the PRD flags
// Alerts' own privacy rule as likely defaulted to "everyone" in the
// source — never fixed, just noted as a gap. That gap is not inherited
// here: RLS (packages/db/migrations/0023) restricts every row to
// `intended_for_user_id = auth.uid()`, both for reads and for the one
// self-service write (marking read). There is deliberately no INSERT
// policy for `authenticated` at all — every row is written by
// `create_alert` (SECURITY DEFINER), matching order_submission_logs'
// closed-to-raw-writes shape.
export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  intendedForUserId: uuid("intended_for_user_id")
    .notNull()
    .references(() => profiles.userId, { onDelete: "cascade" }),
  alertTypeId: uuid("alert_type_id")
    .notNull()
    .references(() => alertTypes.id),
  read: boolean("read").notNull().default(false),
  // The PRD's own "Display Record UNID" — deliberately untyped/unlinked to
  // any one table (an Alert can point at a trading day, an order, etc.),
  // matching the source's own polymorphic reference. Combined with the
  // alert_type's appScreen/urlParameter to build the deep link.
  displayRecordId: uuid("display_record_id"),
  numberForDisplay: numeric("number_for_display", { precision: 10, scale: 2 }),
  fullNameForDisplay: text("full_name_for_display"),
  sendAsWhatsapp: boolean("send_as_whatsapp").notNull(),
  sendAsNotification: boolean("send_as_notification").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
