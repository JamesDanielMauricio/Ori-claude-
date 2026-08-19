import { numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { companies } from "./company";
import { dailyArrangements } from "./daily-arrangement";
import { dailyOrderProducts } from "./daily-order-product";
import { dailyPickProducts } from "./daily-pick-product";

// A single grower-supply-to-customer-demand match: `quantity_pallets` of
// one `daily_pick_product` line arranged to one `daily_order_product`
// line — a specific pick line paired with a specific order line, per the
// arrangement module's own requirement, not just "a pick line and a
// customer company" the way the source's `dailyarrangementrecords` did
// (it never linked to a specific order line at all, only the customer
// company — a real loss of precision this schema doesn't repeat).
// `customer_company_id` stays as a denormalized column (derived from
// `daily_order_product_id`'s parent order at write time, by
// `create_arrangement_record`/`update_arrangement_record`, never supplied
// independently) purely so RLS and read queries don't need a join to
// scope by customer.
export const arrangementRecords = pgTable("arrangement_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  dailyArrangementId: uuid("daily_arrangement_id")
    .notNull()
    .references(() => dailyArrangements.id, { onDelete: "cascade" }),
  dailyPickProductId: uuid("daily_pick_product_id")
    .notNull()
    .references(() => dailyPickProducts.id, { onDelete: "cascade" }),
  dailyOrderProductId: uuid("daily_order_product_id")
    .notNull()
    .references(() => dailyOrderProducts.id, { onDelete: "cascade" }),
  customerCompanyId: uuid("customer_company_id")
    .notNull()
    .references(() => companies.id),
  quantityPallets: numeric("quantity_pallets", { precision: 10, scale: 2 }).notNull(),
  price: numeric("price", { precision: 10, scale: 2 }),
  // Snapshot of which price type produced `price` — populated alongside
  // it by close_arrangement's price-population step (or by an explicit
  // override at create/update time). Free text, matching
  // product_varieties.priceType (R1 — the PRD never gives a closed list).
  priceType: text("price_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
