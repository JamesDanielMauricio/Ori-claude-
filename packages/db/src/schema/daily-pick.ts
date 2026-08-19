import { pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { companies } from "./company";
import { dailyPickStatusEnum } from "./enums";
import { tradingDays } from "./trading-day";

// One Daily Pick per (trading day, grower company) — bootstrapped by
// `bootstrap_grower_pick` (called from `initiate_business_day`, and
// re-callable any time the distributor changes a grower's in-season
// products mid-day — see 0014) for every active grower with a non-empty
// in-season product list. Status mirrors the lifecycle phase per
// Invariant 4: draft/submitted through phase 3, mass-closed at phase 4 by
// `close_arrangement`.
export const dailyPicks = pgTable(
  "daily_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tradingDayId: uuid("trading_day_id")
      .notNull()
      .references(() => tradingDays.id, { onDelete: "cascade" }),
    growerCompanyId: uuid("grower_company_id")
      .notNull()
      .references(() => companies.id),
    status: dailyPickStatusEnum("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    // Set by the distributor's "send a reminder" action on the Grower
    // Inventory Status screen — a real, persisted signal ("last reminded
    // at"), not a fire-and-forget WhatsApp dispatch (that integration
    // doesn't exist yet — see the notifications module).
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.tradingDayId, table.growerCompanyId)],
);
