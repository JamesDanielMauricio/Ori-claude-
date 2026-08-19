import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { packTypeEnum } from "./enums";
import { productFamilies } from "./product-family";

// The sellable catalog item — the PRD's `produce` entity. `priceType` is
// free text rather than an enum: the PRD documents "about a dozen values
// (Record, Record + 1, Range, Number, etc.)" without ever giving the full
// list, so a closed enum here would encode values we don't actually have
// (R1). `packType` IS a real enum (see enums.ts) because the PRD fully
// enumerates it. `version` backs optimistic concurrency on saves (R7) — see
// the `save_product` function in the reference-data migration; every
// update increments it in the same statement that writes the row.
export const productVarieties = pgTable("product_varieties", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id")
    .notNull()
    .references(() => productFamilies.id),
  name: text("name").notNull(),
  sizes: text("sizes"),
  packType: packTypeEnum("pack_type"),
  price: numeric("price", { precision: 10, scale: 2 }),
  priceRangeFrom: numeric("price_range_from", { precision: 10, scale: 2 }),
  priceRangeTo: numeric("price_range_to", { precision: 10, scale: 2 }),
  priceType: text("price_type"),
  noOverbooking: numeric("no_overbooking", { precision: 10, scale: 2 }).notNull().default("0"),
  highlightPriceFluctuations: boolean("highlight_price_fluctuations").notNull().default(false),
  // Catalog-level "orderable at all this season" flag — distinct from a
  // grower's own products_in_season_list (grower-product.ts), which
  // selects a subset of whichever varieties are seasonally available.
  isSeasonalAvailable: boolean("is_seasonal_available").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
