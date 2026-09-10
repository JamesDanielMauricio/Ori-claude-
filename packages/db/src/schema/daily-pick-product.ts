import { numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { dailyPicks } from "./daily-pick";
import { productVarieties } from "./product-variety";

// A grower's per-variety pick line for the day — bootstrapped alongside
// its parent `daily_pick` by `bootstrap_grower_pick` (an idempotent
// upsert-and-prune on the natural key `(daily_pick_id, product_variety_id)`
// — see 0014 — not a real+temp record pair; there is no "is temp record"
// concept anywhere in this schema, by design, replacing the source's
// `Is Temp Record` field, R3).
//
// `pallets_picked` is the field the arrangement-edit floor check guards:
// it can never be reduced below what `arrangement_records` already
// commits for this line (see `update_pick_product_pallets`).
// There is deliberately no pickup-time field on this table — pickup time
// is a per-grower (company) setting, not a per-product one; see
// `companies.default_pickup_time` and `daily_picks.pickup_time`.
// `leftover_pallets` is populated once, at pick-close time, by
// `close_out_pick_leftovers` (0014) — the PRD's own `leftovers` and
// `the_number_of_leftover_pallets_after_the_day_ended` fields collapse
// into this one column; they were never two genuinely different values,
// just the same "pallets picked minus pallets arranged" number computed
// at two different points in an unnecessarily long pipeline (R6).
export const dailyPickProducts = pgTable(
  "daily_pick_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dailyPickId: uuid("daily_pick_id")
      .notNull()
      .references(() => dailyPicks.id, { onDelete: "cascade" }),
    productVarietyId: uuid("product_variety_id")
      .notNull()
      .references(() => productVarieties.id),
    palletsPicked: numeric("pallets_picked", { precision: 10, scale: 2 }).notNull().default("0"),
    comment: text("comment"),
    leftoverPallets: numeric("leftover_pallets", { precision: 10, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.dailyPickId, table.productVarietyId)],
);
