import { boolean, pgTable, text } from "drizzle-orm/pg-core";

// A genuine singleton — the platform's WhatsApp on/off toggles, originally
// just two (whatsapp-messaging.md: `whatsapp_toggle` and
// `whatsapp_toggle__messages_to_customers_when_closing_the_day_`), expanded
// in migration 0049 to five as the settings screen grew more granular
// (per-trigger toggles for shop-open/business-day-open, and the old
// combined close-arrangement toggle split into customer/grower). This is
// NOT the R2 "app settings god object" pattern: that anti-pattern was a
// singleton row of "active_X" POINTER fields duplicating state a live
// query already answers (which trading day is open, which pick is
// active). These booleans have no live-query equivalent — they're genuine
// admin-configurable feature flags, the same kind of thing
// `product_varieties.highlight_price_fluctuations` or
// `companies.can_see_product_prices` already are, just not scoped to one
// row of another table. `id boolean primary key default true, check(id)`
// is the standard Postgres single-row-table trick: `id` can only ever be
// `true`, and it's the primary key, so a second row is structurally
// impossible, not just conventionally avoided.
export const notificationSettings = pgTable("notification_settings", {
  id: boolean("id").primaryKey().default(true),
  // Global gate — every other toggle below also requires this to be true.
  whatsappEnabled: boolean("whatsapp_enabled").notNull().default(false),
  // Gates business_day_open_grower (migration 0049) — sent when
  // initiate_business_day runs, to every grower with an in-season list.
  notifyGrowersOnBusinessDayOpen: boolean("notify_growers_on_business_day_open").notNull().default(false),
  // Gates shop_open (migration 0031) — sent to every active customer when
  // open_shop runs.
  shopOpenWhatsappEnabled: boolean("shop_open_whatsapp_enabled").notNull().default(true),
  // The two halves of what was one combined close_arrangement_whatsapp_enabled
  // (migration 0023) before migration 0049 split it.
  closeArrangementCustomerWhatsappEnabled: boolean("close_arrangement_customer_whatsapp_enabled")
    .notNull()
    .default(false),
  closeArrangementGrowerWhatsappEnabled: boolean("close_arrangement_grower_whatsapp_enabled")
    .notNull()
    .default(false),
  // Dev-env-only redirect target (migration 0045) — see that migration's
  // column comment for the full rationale. Nullable: unset means "refuse to
  // send" while in dev, not "fall back to the real recipient".
  whatsappDevOverridePhone: text("whatsapp_dev_override_phone"),
});
