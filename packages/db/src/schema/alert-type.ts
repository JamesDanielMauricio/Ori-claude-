import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// The admin-configurable bank of in-app notification "kinds" (PRD's "Alert
// Types" entity) — deliberately kept separate from notification_templates
// (the source's `main alert`, used only by WhatsApp dispatch). See
// docs/SCHEMA_DECISIONS.md's "Alert Types vs main alert" entry for the
// full field-by-field comparison this split is based on: Alert Types has
// no placeholder-substitution field (Alerts render mainText alongside
// separately-typed displayNumber/displayName, never a find/replace
// target) and a structured in-app navigation target (appScreen +
// urlParameter), where notification_templates has a single
// placeholder-bearing content string and a raw outbound link.
export const alertTypes = pgTable("alert_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  mainText: text("main_text").notNull(),
  secondLineOfText: text("second_line_of_text"),
  sendAsWhatsappDefault: boolean("send_as_whatsapp_default").notNull().default(false),
  sendAsNotificationDefault: boolean("send_as_notification_default").notNull().default(true),
  // A client-side route (e.g. "/customer/history"), not a Bubble-style
  // enumerated screen id — this schema has no equivalent registry of
  // screen names to enumerate against.
  appScreen: text("app_screen").notNull(),
  // Name of the query parameter alerts.displayRecordId should be attached
  // as when navigating (e.g. "day"); null means no parameter is appended.
  urlParameter: text("url_parameter"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
