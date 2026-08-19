import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { lifecycleSessionTypeEnum } from "./enums";
import { profiles } from "./profile";
import { tradingDays } from "./trading-day";

// The lifecycle audit trail (PRD's "Session" entity) — append-only, never
// updated or deleted (see the RLS migration: no UPDATE/DELETE policy
// exists for any role, including backoffice). Written as the LAST
// statement in `close_shop`/`close_arrangement`'s function bodies, so a
// row here means "this transition's side effects fully committed" for
// both phases alike (R6) — the source logged close_arrangement's Session
// as its FIRST action (meaning a row could exist for a failed attempt)
// and close_shop's as its LAST (meaning a row's absence signals failure);
// that asymmetry doesn't survive here, since both functions are single
// transactions where a session row can only ever land if everything
// before it in the same transaction also committed.
export const lifecycleSessions = pgTable("lifecycle_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tradingDayId: uuid("trading_day_id")
    .notNull()
    .references(() => tradingDays.id, { onDelete: "cascade" }),
  sessionType: lifecycleSessionTypeEnum("session_type").notNull(),
  performedBy: uuid("performed_by")
    .notNull()
    .references(() => profiles.userId),
  // Surfaces things worth flagging without blocking the transition — e.g.
  // close_arrangement's Invariant-4 note ("a pick still open at phase 4 is
  // either a legitimate no-show or a bug — surface it, don't silently
  // fold it in") lands here as
  // `{"draftPicksForceClosed": [{"dailyPickId": ..., "growerCompanyName": ...}]}`.
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
