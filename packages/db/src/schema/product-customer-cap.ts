import { integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";

import { companies } from "./company";
import { productVarieties } from "./product-variety";

// Per-customer pallet cap: the maximum pallets of a given variety a
// specific customer can be arranged, overriding the product's own supply
// math for that one customer. Not in the source PRD's field list for
// Product Variety — this is the new control this prompt asks for — modeled
// as its own join table (customer x product) rather than bolted onto
// either row, since it's genuinely a per-pair setting, not a property of
// either the product or the customer alone.
export const productCustomerCaps = pgTable(
  "product_customer_caps",
  {
    productVarietyId: uuid("product_variety_id")
      .notNull()
      .references(() => productVarieties.id, { onDelete: "cascade" }),
    customerCompanyId: uuid("customer_company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    palletCap: integer("pallet_cap").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.productVarietyId, table.customerCompanyId] })],
);
