import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";

import { productVarieties } from "./product-variety";
import { profiles } from "./profile";

// The per-user product blacklist — known-gaps.md flags the source
// implementing this as a list-of-references field on the User row rather
// than the Customer-level gate the PRD describes. Modeled here as a real
// join table (a genuine many-to-many relationship) rather than reproducing
// either shape verbatim — R1/R2. Which entity SHOULD own this gate
// (profile vs. company/customer) is a product question for the
// reference-data module; this table only fixes the "list-of-references on
// an identity row" implementation smell.
export const profileBlockedProducts = pgTable(
  "profile_blocked_products",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "cascade" }),
    productVarietyId: uuid("product_variety_id")
      .notNull()
      .references(() => productVarieties.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.productVarietyId] })],
);
