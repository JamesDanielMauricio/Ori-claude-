import { sql } from "drizzle-orm";
import { check, numeric, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { companies } from "./company";

// The distributor's ranking score for a customer: 1 (lowest) to 5, kept so
// that an arrangement suggestion can order customers by it when a product is
// short.
//
// Its own table rather than a column on `companies` because RLS is per row:
// a customer's users can read their own company row, and this is the one
// fact about a customer that the customer must never be able to read. See
// migrations/0067_customer-scores.sql, which is where that is enforced.
//
// One row per ranked customer; no row means unranked.
export const customerScores = pgTable(
  "customer_scores",
  {
    customerCompanyId: uuid("customer_company_id")
      .primaryKey()
      .references(() => companies.id, { onDelete: "cascade" }),
    generalScore: numeric("general_score", { precision: 3, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "customer_scores_general_score_range",
      sql`${table.generalScore} >= 1 and ${table.generalScore} <= 5`,
    ),
  ],
);
