import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";

import { companies } from "./company";
import { productVarieties } from "./product-variety";

// The PRD's `products_in_season_list` on the Company record, modeled as a
// real many-to-many join table rather than a list-of-references column —
// the same "genuine relationship, not an array field on an identity row"
// call made for profile_blocked_products (see docs/SCHEMA_DECISIONS.md).
// Drives which Daily Pick Product lines get bootstrapped for a grower each
// trading day (a later module's concern; this table is only the catalog
// selection itself).
export const growerProducts = pgTable(
  "grower_products",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productVarietyId: uuid("product_variety_id")
      .notNull()
      .references(() => productVarieties.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.productVarietyId] })],
);
