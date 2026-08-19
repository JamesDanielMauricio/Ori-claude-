import { boolean, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { dailyShopStatusEnum } from "./enums";
import { profiles } from "./profile";
import { tradingDays } from "./trading-day";

// One Daily Shop per trading day — the `unique()` on `trading_day_id` (not
// a separate "is this the active shop" flag) is Lifecycle Invariant 1's
// shop-level equivalent and the concurrency guard on Open Shop: two
// simultaneous `open_shop` calls for the same day race on this constraint,
// exactly one wins (R7).
export const dailyShops = pgTable("daily_shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  tradingDayId: uuid("trading_day_id")
    .notNull()
    .unique()
    .references(() => tradingDays.id, { onDelete: "cascade" }),
  status: dailyShopStatusEnum("status").notNull().default("open"),
  canSeePrices: boolean("can_see_prices").notNull().default(true),
  openedBy: uuid("opened_by")
    .notNull()
    .references(() => profiles.userId),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
