import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { dailyArrangementStatusEnum } from "./enums";
import { tradingDays } from "./trading-day";

// One Daily Arrangement per trading day (created at Phase 1, closed at
// Phase 4 — the terminal transition). `unique()` on `trading_day_id`
// mirrors `daily_shops`' shape; unlike the shop, the source's own
// "mid-cycle re-invoke" note documents that `initiate_business_day` had
// NO guard here (a second call created an orphaned second arrangement) —
// this constraint is what actually closes that gap, not just the
// trading_days-level one, since arrangement creation happens inside the
// same function as the trading-day insert (see 0011's `initiate_business_day`).
export const dailyArrangements = pgTable("daily_arrangements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tradingDayId: uuid("trading_day_id")
    .notNull()
    .unique()
    .references(() => tradingDays.id, { onDelete: "cascade" }),
  status: dailyArrangementStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});
