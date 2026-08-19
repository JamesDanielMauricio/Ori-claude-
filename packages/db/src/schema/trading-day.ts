import { date, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { tradingDayPhaseEnum } from "./enums";
import { profiles } from "./profile";

// The anchor of the four-phase daily lifecycle — replaces the source's
// App Settings singleton entirely (R2). There is no "active_daily_shop" /
// "active_daily_arrangement" / etc. pointer field anywhere in this schema:
// a trading day's shop, picks, orders, and arrangement are just rows with
// a `trading_day_id` foreign key back here, reachable with a normal query
// the whole time the day is open. "Which day is currently open" is
// answered by querying this table for `phase <> 'closed'`, not by reading
// a pointer.
//
// The at-most-one-open-day rule (R7, Lifecycle Invariant 1) is a real
// database constraint — see the partial unique index in
// 0009_lifecycle-schema.sql — not an application-level check. The source
// explicitly had no such guard (initiate_business_day-phase-1.md: "no
// guard against being invoked while a previous day is still active"),
// documented as a real product risk; this schema closes it.
export const tradingDays = pgTable("trading_days", {
  id: uuid("id").primaryKey().defaultRandom(),
  tradeDate: date("trade_date").notNull(),
  phase: tradingDayPhaseEnum("phase").notNull().default("initiated"),
  initiatedBy: uuid("initiated_by")
    .notNull()
    .references(() => profiles.userId),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
