import { pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { companies } from "./company";
import { dailyOrderStatusEnum } from "./enums";
import { tradingDays } from "./trading-day";

// A customer's order header for the day — bootstrapped by `open_shop` for
// every active customer company. Line entry lives in daily-order-product.ts;
// submission (Open → Submitted, stamping submittedAt, and the transactional
// line upsert-and-prune) is `submit_order` — see the customer module's
// migration.
export const dailyOrders = pgTable(
  "daily_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tradingDayId: uuid("trading_day_id")
      .notNull()
      .references(() => tradingDays.id, { onDelete: "cascade" }),
    customerCompanyId: uuid("customer_company_id")
      .notNull()
      .references(() => companies.id),
    status: dailyOrderStatusEnum("status").notNull().default("open"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    // Set by the distributor's "send a reminder" action on the Customer
    // Order Status screen — mirrors daily_picks.reminderSentAt exactly,
    // just the customer-side equivalent.
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.tradingDayId, table.customerCompanyId)],
);
