import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { notificationChannelEnum } from "./enums";

// The source's `main alert` entity — a small, stable set of named
// outbound-message templates referenced by ID directly from workflow code
// (e.g. close_arrangement pulls "close_arrangement_customer"/
// "close_arrangement_grower" by templateKey), NOT the admin-configurable
// Alert Types bank. See docs/SCHEMA_DECISIONS.md for why these stay two
// tables. `content` carries the source's own placeholder tokens
// (%FIRST_NAME%, %ORDER_DETAILS%, %CURRENT_OPEN_BUSINESS_DAY%, %NL%),
// substituted per-recipient by `substitute_template_placeholders` at
// dispatch time (packages/db/migrations/0024).
export const notificationTemplates = pgTable("notification_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateKey: text("template_key").notNull().unique(),
  channel: notificationChannelEnum("channel").notNull().default("whatsapp"),
  title: text("title"),
  content: text("content").notNull(),
  // Outbound URL appended after the substituted content — kept as a
  // separate field, not spliced into `content` via its own placeholder,
  // matching whatsapp-messaging.md's own description ("summary... + a
  // per-recipient link").
  link: text("link"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
