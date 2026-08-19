import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// The catalog's high-level grouping ("בננות"/Bananas, "תפוחים"/Apples).
// `category` is free text, not a Postgres enum — the PRD gives only
// examples ("fruit / vegetable / herb"), not an exhaustive value list, and
// inventing a closed set the PRD never actually specifies would be adding
// a requirement, not preserving one (R1).
export const productFamilies = pgTable("product_families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
