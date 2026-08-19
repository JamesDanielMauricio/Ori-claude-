import { boolean, pgTable } from "drizzle-orm/pg-core";

// A genuine singleton — the platform's two WhatsApp on/off toggles
// (whatsapp-messaging.md: `whatsapp_toggle` and
// `whatsapp_toggle__messages_to_customers_when_closing_the_day_`). This is
// NOT the R2 "app settings god object" pattern: that anti-pattern was a
// singleton row of "active_X" POINTER fields duplicating state a live
// query already answers (which trading day is open, which pick is
// active). These two booleans have no live-query equivalent — they're
// genuine admin-configurable feature flags, the same kind of thing
// `product_varieties.highlight_price_fluctuations` or
// `companies.can_see_product_prices` already are, just not scoped to one
// row of another table. `id boolean primary key default true, check(id)`
// is the standard Postgres single-row-table trick: `id` can only ever be
// `true`, and it's the primary key, so a second row is structurally
// impossible, not just conventionally avoided.
export const notificationSettings = pgTable("notification_settings", {
  id: boolean("id").primaryKey().default(true),
  whatsappEnabled: boolean("whatsapp_enabled").notNull().default(false),
  closeArrangementWhatsappEnabled: boolean("close_arrangement_whatsapp_enabled").notNull().default(false),
});
