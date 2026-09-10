import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { companies } from "./company";
import { notificationRecipientTypeEnum } from "./enums";
import { tradingDays } from "./trading-day";

// The durable half of the notification pipeline (R4's external-system
// carve-out): a Postgres function can't safely make an outbound WhatsApp
// HTTP call as part of its own transaction, and per R4 it shouldn't try
// to. `close_arrangement`'s last step writes one row per recipient here,
// in the same transaction as the status/price changes — a plain table
// insert, no network call, so it either commits with everything else or
// not at all. A Supabase Edge Function (or scheduled job — a later
// prompt) drains this table and performs the actual WhatsApp dispatch
// after the transaction has already committed, so a flaky external call
// can never roll back a successful close.
export const notificationOutbox = pgTable("notification_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  tradingDayId: uuid("trading_day_id")
    .notNull()
    .references(() => tradingDays.id, { onDelete: "cascade" }),
  recipientType: notificationRecipientTypeEnum("recipient_type").notNull(),
  recipientCompanyId: uuid("recipient_company_id")
    .notNull()
    .references(() => companies.id),
  // The arrangement summary a later prompt's drain job formats into a
  // WhatsApp message — family/variety/pallets/price per line, the
  // grower or customer's own arrangement rows only. Computed once, here,
  // while the transaction still has a consistent view of the day's
  // arrangement; the drain job reads this payload rather than
  // re-querying the (by-then-closed, still-correct-but-decoupled) day.
  payload: jsonb("payload").notNull(),
  // Which notification_templates row `resolve_outbox_dispatch` pulls to
  // compose the message — one per recipient_type
  // ("close_arrangement_customer"/"close_arrangement_grower" today), set
  // by build_notification_outbox. Not a foreign key: the drain job (and
  // its tests) needs to keep working even for a template that hasn't been
  // authored yet, surfacing that as a clear NOT_FOUND at dispatch time
  // rather than blocking the close_arrangement transaction on it.
  templateKey: text("template_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Set by the drain job once dispatch succeeds — null means "not yet
  // sent." attemptCount/lastError/lastAttemptedAt are the real
  // retry/observability this module replaces the source's single
  // hardcoded-email dead-letter with (see docs/ARCHITECTURE.md's
  // notifications module section) — a row that keeps failing accumulates
  // a visible attempt history instead of silently vanishing into one
  // unmonitored inbox.
  sentAt: timestamp("sent_at", { withTimezone: true }),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
  lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
  // Which recipients this row has already reached (migration 0038). One
  // outbox row fans out to one message PER recipient when the company has no
  // WhatsApp group id, so "was this row sent" is not a single boolean:
  // without this, a retry after one unreachable number re-sent the message to
  // everyone who had already received it. The drain skips any target listed
  // here and only sets sentAt once every target is accounted for.
  sentTargets: text("sent_targets").array().notNull().default([]),
});
