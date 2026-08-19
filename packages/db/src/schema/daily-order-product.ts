import { numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { dailyOrders } from "./daily-order";
import { productVarieties } from "./product-variety";

// A customer's per-variety order line — created/updated/pruned by
// `submit_order` (upsert-and-prune on the natural key
// `(daily_order_id, product_variety_id)`, the same shape as
// `bootstrap_grower_pick`, R3). Replaces the source's dash-packed
// `"<order-id>-<pallets>-<comment>-<line-id>"` per-line save workflow
// (real, documented fragility: unescaped dashes in a comment corrupt the
// parse — R1 discards that mechanism, not the "customer can set pallets +
// comment per variety" behavior it existed to serve).
//
// A row with `pallets_ordered = 0` never exists: `submit_order` deletes
// the line instead of writing zero, matching the PRD's own hard-delete
// rule — there is no `Deleted` soft-delete flag or `no_of_pallets_before`
// history list here (R2); the row's mere existence at a positive quantity
// is the only state that matters.
export const dailyOrderProducts = pgTable(
  "daily_order_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dailyOrderId: uuid("daily_order_id")
      .notNull()
      .references(() => dailyOrders.id, { onDelete: "cascade" }),
    productVarietyId: uuid("product_variety_id")
      .notNull()
      .references(() => productVarieties.id),
    palletsOrdered: numeric("pallets_ordered", { precision: 10, scale: 2 }).notNull().default("0"),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.dailyOrderId, table.productVarietyId)],
);
