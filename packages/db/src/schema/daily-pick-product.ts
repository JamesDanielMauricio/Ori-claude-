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
// `leftover_pallets` starts each new trading day carried forward from this
// grower+variety's most recent prior line (`bootstrap_grower_pick` /
// `sync_grower_picks`, migration 0050), then is independently editable in
// the picking editor alongside `pallets_picked` — a grower can see which
// pallets are freshly picked vs. carried over, and can zero out leftover
// that has since gone bad without touching today's pick. It counts as real
// arrangeable supply: `pallets_picked + leftover_pallets` is the allocation
// ceiling (`check_arrangement_allocation`) and the arrangement-edit floor
// both fields are jointly held to (`save_pick_lines`). `leftover_pallets`
// means "carried in" on every day, open or closed. At day-close,
// `close_out_pick_leftovers` writes `pallets_picked + leftover_pallets -
// arranged` into `end_of_day_leftover_pallets` (null while the day is open),
// which becomes the next day's carry-in. These are Bubble's two leftover
// fields (`Leftovers`, `Leftover Pallets After Day End`): one column used to
// hold both, overwritten at close (0050), until 0070 split them again —
// don't collapse them back.
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
    leftoverPallets: numeric("leftover_pallets", { precision: 10, scale: 2 }).notNull().default("0"),
    endOfDayLeftoverPallets: numeric("end_of_day_leftover_pallets", { precision: 10, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.dailyPickId, table.productVarietyId)],
);
