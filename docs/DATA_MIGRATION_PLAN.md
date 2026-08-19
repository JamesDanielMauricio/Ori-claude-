# Data Migration Plan — live Bubble project → this schema

Written against the live Bubble project (`app.harpazmarketing.com`, app `uri-and-the-bananas`)
on 2026-07-12, via the st4ck `bubble_get_schema`/`bubble_list_records` MCP tools. Row counts and
findings below are a snapshot from that date — re-verify counts immediately before any real
cutover, since the source is a live, actively-traded system.

**This plan was not executed against production.** Building and documenting the migration path
was this prompt's deliverable; actually running it is a separately-authorized, one-way cutover
action against real customer data that needs its own dedicated window (see § Cutover procedure).

## 1. Source snapshot (2026-07-12)

| Bubble data type | Row count | Maps to |
| --- | --- | --- |
| `company` | 111 | `companies` |
| `user` | 91 | `auth.users` + `profiles` |
| `customer` | **0** | *(unused — superseded by `product_customer_caps`, confirmed empty in production)* |
| `productfamily` | 142 | `product_families` |
| `productvarieties` | 1,288 | `product_varieties` |
| `dailyshop` | 352 | `daily_shops` |
| `dailyshopproduct` | **0** | *(unused, no equivalent)* |
| `dailypick` | 7,288 | `daily_picks` |
| `dailypickproduct` | 129,981 | `daily_pick_products` — **excluding temp records** (see § 4) |
| `dailyorder` | 9,052 | `daily_orders` |
| `dailyorderproducts` | 35,063 | `daily_order_products` |
| `dailyarrangement` | 308 | `daily_arrangements` |
| `dailyarrangementrecords` | 7,416 | `arrangement_records` — **needs reconciliation** (see § 4) |
| `appsettings` | 1 (singleton) | *(no direct equivalent — R2; only its **current** phase-in-flight state matters at cutover)* |
| `session` | 279 | `lifecycle_sessions` — **needs enum extension** (see § 3) |
| `mainalert` | 11 | `notification_templates` — all 11 triggers now built (see § 3b/3d) |
| `alerttypes` | **0** | `alert_types` *(nothing to migrate)* |
| `alerts` | **0** | `alerts` *(nothing to migrate)* |
| `productleftover` | 131,795 | *(redundant with `daily_pick_products.leftover_pallets` — spot-check only, not migrated as a separate table; see § 4)* |
| `dailycheckingofemptyorders` | **0** | *(no equivalent needed — confirms the R6 decision already made in the grower/customer modules)* |

Total rows in scope for a real 1:1 migration, after excluding the empty/redundant types above:
**~191,000**, dominated by `dailypickproduct` (130K) and `productleftover` (132K, not migrated,
spot-check only).

## 2. Migration tooling (built, in `packages/db/`)

- **`migrations/0026_bubble-migration-staging.sql`** (applied) — `_bubble_migration_id_map`
  (Bubble `_id` → new `uuid`, per entity type) and `_bubble_migration_log` (anything the ETL
  script couldn't migrate cleanly). Both RLS-enabled with zero policies — inaccessible to
  `authenticated`/`anon` entirely, only a trusted/service-role connection can touch them. Kept
  permanently after cutover as an audit trail, not dropped.
- **`migrations/0027_lifecycle-session-type-historical-values.sql`** (applied) — extends
  `lifecycle_session_type` with three `historical_*` values (see § 3).
- **`scripts/migrate-from-bubble.ts`** (`pnpm --filter @ori/db migrate:from-bubble -- --dry-run`
  by default; `-- --commit` to actually write) — the ETL script itself. Implements the mechanical,
  unambiguous steps in full (companies, users, product catalog, trading-day reconstruction);
  deliberately stops before the steps that need a human decision first (§ 5), rather than guessing.

These are real Drizzle Kit migrations, tracked in this project's own `__drizzle_migrations` table
against the remote Supabase project — the same mechanism every other migration in
`packages/db/migrations/` uses, not a separate Supabase-CLI-tracked path.

## 3. Findings from the live data that changed this plan

Reading the actual production rows — not just the PRD text — surfaced three things worth
recording here because they contradict or extend what earlier prompts' documentation assumed.

**a. The source audits five session types, not two.** `docs/ARCHITECTURE.md`'s lifecycle-engine
section and `reference/prd/lifecycle-invariants.md` both stated "phases 1 and 2 are not audited in
the source either" (only `close_shop`/`end_the_day` sessions exist). The live `session` table
shows five distinct values: `initiate day`, `open shop`, `close shop`, `end the day`, and `update`
(an ad-hoc type from mid-day edit workflows). That written claim was wrong, or true of an earlier
app version — ground truth from the live data overrides it. `lifecycle_session_type` is extended
with `historical_initiate_day`/`historical_open_shop`/`historical_update` (0027) purely so the
migration can preserve this full history without lossy remapping. **This rebuild's own functions
still only ever write `close_shop`/`end_the_day`** — whether `initiate_business_day`/`open_shop`
should also start logging a session is a real, separate product decision for a future prompt, not
something this migration should decide as a side effect.

**b. `mainalert`'s real templates, and the triggers behind them — now fully built.** Prompt 9's
`notification_templates`/`substitute_template_placeholders` originally implemented only the four
tokens the PRD's `close-arrangement-phase-4-terminal.md` names (`%FIRST_NAME%`, `%ORDER_DETAILS%`,
`%CURRENT_OPEN_BUSINESS_DAY%`, `%NL%`); the live `mainalert` table's 11 rows also used `%COMPANY%`,
`%PICKUP_TIME%`, `%COMPANY_USER_FULL_NAME%`, `%PRODUCT_NAME%`, and `%PRODUCT_OVERBOOKING%`.
`substitute_template_placeholders` (0031) was extended with `%COMPANY%`/`%PRODUCT_NAME%`/
`%PRODUCT_OVERBOOKING%` (the three the built triggers actually needed); `%PICKUP_TIME%`/
`%COMPANY_USER_FULL_NAME%` were never needed since ids 6/8's rebuilt triggers use simplified wording
(see the table below).
**Resolution — all 11 rows now have a real, built trigger.** Every id below was closed across two
prompts: id 5 first, then the remaining eight (ids 1/2 as one shared trigger, 3, 4, 6, 8, 10, 11) —
all through the existing NotificationService/outbox pattern (Prompt 9), no new dispatch mechanism.
The final row-by-row mapping —

| id | Content (paraphrased) | Status |
| --- | --- | --- |
| 1, 2 | Grower pick reminder ("please update your pick estimate") — identical duplicate rows, one shared trigger | **Closed.** `send_pick_reminder` (0029) now also writes a `notification_outbox` row (`template_key = 'pick_reminder'`) alongside its existing `reminder_sent_at` stamp — previously a dispatch-less stub, retrofitted to match `send_order_reminder`'s shape. |
| 3 | "COMPANY updated their pick estimate" (to backoffice) | **Closed.** `update_pick_product_pallets` (0031) enqueues `template_key = 'pick_updated'` to every active backoffice company — but only when the GROWER themselves made the edit, never on the backoffice-on-behalf-of path (that would be backoffice notifying itself). |
| 4 | "The shop is now open for orders" (to customers) | **Closed.** `open_shop` (0031) enqueues `template_key = 'shop_open'` to every active customer, in the same transaction as the phase change. |
| 5 | "This is a reminder to send an order for day X" (to a customer) | **Closed.** `send_order_reminder` (0028) — the customer order reminder, not a grower message (an earlier pass in this doc had mis-grouped it with ids 1/2). |
| 6 | "COMPANY sent an order via USER — here's their current status" (to backoffice) | **Closed.** `submit_order` (0031/0032) enqueues `template_key = 'order_submitted'` to every active backoffice company — same "only on the direct-caller path, never on-behalf-of" rule as id 3. Opposite direction from id 5. |
| 7, 9 | Arrangement summary to a grower / customer | **Functionally closed, differently.** Prompt 9's `close_arrangement_grower`/`close_arrangement_customer` templates already dispatch this on `close_arrangement` — purpose-built rewrites, not literal ports of ids 7/9's exact wording (no `%PICKUP_TIME%` placeholder). |
| 8 | Arrangement summary to a grower, "also sent to the transporter" | **Closed.** `build_notification_outbox` (0031) adds a third insert: any grower with `companies.transporter_company_id` set (a field this schema didn't have until this prompt — see § 3d below) gets an identical `close_arrangement_grower`-templated row cc'd to their transporter, one message per grower even when a transporter serves several. |
| 10 | "All picked pallets for PRODUCT ordered — N more pallets of overbooking room remain" (to backoffice) | **Closed.** `submit_order` (0031/0032) computes this live inside its own transaction, immediately after writing the order lines that could have caused it — comparing global demand before/after this specific call, per touched variety. No stored out-of-stock list, no trigger (deliberately, per this project's own `get_orderable_catalog_for_customer` design — see 0018's header comment). `template_key = 'stock_overbooking_reached'`. |
| 11 | "All pallets + overbooking for PRODUCT ordered — no longer orderable" (to backoffice) | **Closed.** Same live computation as id 10, the other threshold crossing. `template_key = 'stock_fully_exhausted'`. |

**d. "Notify backoffice" needed one consistent addressing pattern, not four ad-hoc ones.**
Backoffice is a role, not a single company — nothing in this schema enforces exactly one
backoffice-typed company. `enqueue_backoffice_notification` (0031, internal-only — no grant to
`authenticated`, since it's never a legitimate direct client RPC target) is the one pattern every
backoffice-addressed trigger (ids 3, 6, 10, 11) reuses: one outbox row per active backoffice
company, the same "one row per company" shape `build_notification_outbox` already used for
growers/customers.

`companies.transporter_company_id` (self-referencing FK, added 0031) was needed for id 8 and was a
genuine, pre-existing PRD gap — `reference/prd/company.md`'s own field table never listed it, despite
the live `company.Transporter` field being populated on real grower rows.

Migrated all 11 rows into `notification_templates` as historical record during the ETL pass
regardless of whether their trigger is closed by this project's own purpose-built template
(`close_arrangement_grower`/`_customer` for ids 7/9) or a newly-seeded one matching this project's
own trigger (ids 1/2/3/4/5/6/8/10/11) — the historical row and the live trigger are never required to
share byte-for-byte wording, only the same underlying business event.

**c. `arrangement_records` has no historical order-line link to migrate from.** Confirmed via
`bubble_get_schema`: the source's `dailyarrangementrecords` links a pick product to a customer
*company* (`linked to company (customer)`), never a specific `dailyorderproducts` row — the exact
gap Prompt 8 closed by adding `daily_order_product_id` as a real, `not null` foreign key. A
historical `dailyarrangementrecords` row therefore has to be **matched, not read directly**, to
the specific `daily_order_products` row it corresponds to (by trading day + product variety +
customer company). Where a customer has more than one order line for the same variety on the same
day in the source data (this schema's own natural-key uniqueness on `(daily_order_id,
product_variety_id)` should prevent that going forward, but the source never enforced it), the
match is ambiguous. **This is the one genuinely hard step in the whole migration** — see § 5.

## 4. Exclusion / consolidation rules

- **`dailypickproduct` rows with `Is Temp Record? = true` are skipped, not migrated.** This
  schema's `bootstrap_grower_pick` (Prompt 6) replaced the source's real+temp record pair with a
  true idempotent upsert-and-prune (R3) — there is no "is temp record" concept anywhere in this
  schema, by design. Migrating temp rows would recreate exactly the placeholder-row pattern R3
  eliminated. The ETL script logs a count of skipped temp rows per grower/day to
  `_bubble_migration_log` so the reduction is visible, not silent.
- **`productleftover`'s 131,795 rows are not migrated into a new table.** This schema consolidated
  the source's leftover-tracking (which — per `docs/ARCHITECTURE.md`'s grower-picking-module
  section — already spanned *two* near-duplicate fields on `dailypickproduct` itself,
  `Leftovers`/`the number of leftover pallets after the day ended`) into one
  `daily_pick_products.leftover_pallets` column, computed by `close_out_pick_leftovers`. This
  separate `productleftover` *table* is a third, apparently-redundant leftover-tracking mechanism
  — the plan's recommendation is a **post-migration spot-check** (sample N `productleftover` rows,
  confirm the migrated `daily_pick_products.leftover_pallets` for the matching grower/variety/date
  agrees), not a 1:1 import into a table this schema deliberately doesn't have.
- **`customer`, `dailyshopproduct`, `dailycheckingofemptyorders`** — confirmed **0 rows** in
  production. Nothing to migrate; these entities' absence in the rebuilt schema (R6 decisions made
  in earlier prompts) is validated by the live data, not just theorized from the PRD.
- **`alerttypes`, `alerts`** — confirmed **0 rows**. The notifications module (Prompt 9) starts
  with an empty, ready-to-use schema; no historical data exists to bring over.

## 5. Open decisions — needed before the ETL script's remaining steps are written

These are genuine judgment calls, not something to guess at inside a migration script. Each
blocks one specific, currently-unwritten step in `migrate-from-bubble.ts` (see that file's own
`main()` and its trailing log line).

1. **Arrangement-record reconciliation (§ 3c).** Match strategy: for each
   `dailyarrangementrecords` row, resolve `daily_pick_product_id` (direct, via the id map) and look
   up the customer's `daily_order_products` row for the same trading day + product variety. If
   exactly one match exists, migrate it. If zero or multiple match, **log it and skip** (don't
   guess) — `_bubble_migration_log` gives a concrete, reviewable list to resolve by hand (or by a
   documented tie-break rule, e.g. "earliest-created order line wins") before a second pass.
2. **`notification_templates` migration scope — resolved.** Migrate all 11 `mainalert` rows as
   historical record (§ 3b/3d); no longer a decision blocked on future work — every trigger they
   correspond to is now built (either directly, or functionally by a differently-worded purpose-built
   template for ids 7/9).
3. **Which admin user is `trading_days.initiated_by` for reconstructed historical days?**
   `reconstructTradingDays()` (written, not yet called from `main()`) needs one real, already-
   migrated user id — the live `appsettings.assigned distributor for reset password` field is the
   most defensible choice (Bubble id `1737557821674x582707536349699600` as of this snapshot), but
   confirm that's still the right distributor account before wiring the call up.
4. **Historical `session` rows for `initiate day`/`open shop`/`update`** — migrate all 279, or only
   `close shop`/`end the day` (the two this schema's own functions still produce)? Recommend:
   migrate all five types now that the enum supports them (§ 3a) — a fuller audit trail costs
   nothing extra to keep.

## 6. Cutover procedure

1. **Wait for a natural `close_arrangement`.** The live `appsettings` snapshot shows
   `shop_status: "Open"` — a trading day is **currently mid-flight** in production. Do not migrate
   while a day is open; either wait for the distributor to close it naturally, or coordinate an
   explicit freeze window with them. Migrating mid-day would require synthesizing a trading day
   with in-progress orders/picks that the new schema's own RLS-governed write paths never produced,
   which is a materially riskier migration than "every migrated day is already closed."
2. **Freeze writes on the Bubble app** for the migration window (make the app read-only, or take it
   offline) — the ETL script reads once, not incrementally; any write to Bubble after the read
   starts is invisible to the migration.
3. **Re-run the row counts in § 1** immediately before starting, to catch drift since this plan was
   written.
4. **Run `pnpm --filter @ori/db migrate:from-bubble -- --dry-run`** first. Review its console
   output and the resulting `_bubble_migration_log` rows (temp-record skip counts, any
   unresolved-Company/unrecognized-Role warnings) before proceeding.
5. **Resolve every § 5 open decision** and finish the ETL script's remaining steps (shops,
   arrangements, picks, pick-product lines, orders, order-product lines, the arrangement-record
   reconciliation, session import, template import) — none of that logic is contentious, it's just
   not written yet because it depends on those decisions.
6. **Run with `-- --commit`.**
7. **Verify** (§ 7) before letting any user sign in to the new system.
8. **Communicate the forced password reset** (§ "User migration" note below) to every migrated
   user before or immediately after cutover — this is a real, visible change from their
   perspective, not an invisible backend detail.

**User migration note.** Bubble's Data API never exposes password hashes (by design — not even to
a fully-privileged API token). Every migrated user gets a fresh Supabase Auth account with
`must_change_password = true`, the same forced-reset mechanism this project's bulk-import already
uses. There is no way to preserve existing passwords across this migration; every one of the 91
users needs a recovery link or an admin-mediated reset (`reference/prd/reset-password-admin-
mediated.md`, already implemented — see `packages/domain/src/auth/admin-reset-password.ts`) before
they can sign in to the new system.

## 7. Post-migration verification

- **Row counts.** For every migrated entity, `select count(*)` on the new table should equal the
  source count minus documented exclusions (temp `dailypickproduct` rows, any logged arrangement-
  record reconciliation misses). A mismatch outside that expected delta means something silently
  failed — check `_bubble_migration_log` for `error`-severity rows first.
- **Spot-check `productleftover` against `daily_pick_products.leftover_pallets`** (§ 4) — sample at
  least 20 grower/variety/date combinations across different weeks.
- **FK integrity** — this schema's own `not null`/foreign-key constraints already make an orphaned
  reference impossible to insert in the first place (the migration script would fail loudly, not
  silently, on any such row) — no separate integrity pass is needed beyond confirming the commit
  run completed without unhandled errors.
- **If a Supabase connection is ever linked in st4ck too**, `supabase_query`/`supabase_list_tables`/
  `supabase_describe_table` can cross-check the migrated schema/counts directly from that tool
  as a second, independent confirmation — optional, not required (this plan's own counts above
  were captured via direct `psql`-equivalent access through this session's own tooling).
- **One real end-to-end smoke test post-migration**: sign in as one migrated backoffice user (after
  their forced reset), confirm they can see the most recent closed trading day's arrangement
  records with correct grower/customer/variety/quantity, and confirm a migrated customer's order
  history shows their real past orders.

## 8. What this plan deliberately does not attempt

- **No live/incremental sync.** This is a one-time cutover, not a dual-write or ongoing
  replication setup. Once cutover happens, Bubble is retired for this data.
- **No UI-level data (images, comments-as-rendered-in-app, etc.) migration beyond what's listed
  above.** `logo`/`image` fields on `company`/`productfamily`/`productvarieties` are out of scope
  for this plan — flagged for a follow-up if the new UI ends up needing them.
