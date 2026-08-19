import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { dailyOrders } from "./daily-order";
import { profiles } from "./profile";

// v1.3's new feature (kept as-is, R6): one append-only row per submission
// event, not a running mutation of the order header — so a customer who
// submits three times in a day leaves three rows, each a snapshot of what
// was submitted at that moment. Gives the distributor/support a real
// history of how a customer's cart evolved, for dispute resolution —
// distinct from `daily_orders`/`daily_order_products`, which only ever
// hold the CURRENT state.
export const orderSubmissionLogs = pgTable("order_submission_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  dailyOrderId: uuid("daily_order_id")
    .notNull()
    .references(() => dailyOrders.id, { onDelete: "cascade" }),
  submittedBy: uuid("submitted_by")
    .notNull()
    .references(() => profiles.userId),
  // `[{ "productVarietyId": uuid, "palletsOrdered": number, "comment": string|null }, ...]`
  // — exactly the line set `submit_order` wrote in this same transaction.
  snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
