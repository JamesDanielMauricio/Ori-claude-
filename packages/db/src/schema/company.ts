import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { boolean, pgTable, text, time, timestamp, uuid } from "drizzle-orm/pg-core";

import { companyStatusEnum, companyTypeEnum } from "./enums";

// The full Company aggregate — growers, customers, transporters, and the
// distributor's own backoffice company are all rows here, discriminated by
// `type`, per the PRD's own entity model ("Names of growers, customers,
// distributors, and transporters are all Company records"). This is a
// deliberate polymorphic table, not the R2 "god object" pattern: R2 is
// about a *singleton* config record with list-of-reference fields that get
// manually cleared, not about a normal entity table that happens to have a
// type discriminator — there's no cardinality-one config row here, and no
// field on this table is ever "the current X".
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: companyTypeEnum("type").notNull(),
  status: companyStatusEnum("status").notNull().default("active"),
  // Grower-only in practice (PRD: "Only meaningful for Grower companies").
  // Left nullable rather than split into a per-type table — the PRD's own
  // "meaningful for X only" fields are a real, if slightly awkward,
  // business shape (R6), not something to redesign away in this pass.
  defaultPickupTime: time("default_pickup_time"),
  // Grower-only in practice — the transporter company assigned to move
  // that grower's arranged produce. Missing from reference/prd/company.md's
  // own field table (a real PRD gap, same shape as the mainalert/session-
  // type gaps found elsewhere) but confirmed live via the source's
  // `company.Transporter` field, populated on real grower rows. Self-
  // referencing FK, default RESTRICT — deleting a transporter company
  // while a grower still points at it is a data-integrity problem to
  // surface, not silently null out.
  transporterCompanyId: uuid("transporter_company_id").references((): AnyPgColumn => companies.id),
  // Customer-only in practice — whether this company sees prices in
  // arrangement-close WhatsApp notifications.
  canSeeProductPrices: boolean("can_see_product_prices"),
  // Company-level WhatsApp group id for notifications; when empty the
  // notifications module falls back to per-user dispatch (a later
  // module's concern, not this table's).
  whatsappGroupId: text("whatsapp_group_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
