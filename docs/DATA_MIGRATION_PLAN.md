# Data Migration — Bubble → this schema

**Status (2026-09-16): imported.** The Bubble **test** database (st4ck's "staging" code version is
exported from Bubble's `version-test` app) was imported into the hosted Supabase project, replacing
its demo data. The two scripts in § 2 can repeat the import at any time; a re-run replaces
everything again.

Sections 1 and 3 are the original research against the **live** Bubble project (2026-07-12), kept
for their findings. Sections 2 and 4–8 describe what was built and run.

## 1. Live source snapshot (2026-07-12, historical)

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
| `dailypickproduct` | 129,981 | `daily_pick_products` — **excluding temp records** |
| `dailyorder` | 9,052 | `daily_orders` |
| `dailyorderproducts` | 35,063 | `daily_order_products` |
| `dailyarrangement` | 308 | `daily_arrangements` |
| `dailyarrangementrecords` | 7,416 | `arrangement_records` — **needs reconciliation** (see § 3c) |
| `appsettings` | 1 (singleton) | *(no direct equivalent — R2)* |
| `session` | 279 | `lifecycle_sessions` — **needs enum extension** (see § 3a) |
| `mainalert` | 11 | `notification_templates` — all 11 triggers now built (see § 3b/3d) |
| `alerttypes` | **0** | `alert_types` *(nothing to migrate)* |
| `alerts` | **0** | `alerts` *(nothing to migrate)* |
| `productleftover` | 131,795 | *(redundant with `daily_pick_products.leftover_pallets`)* |
| `dailycheckingofemptyorders` | **0** | *(no equivalent needed)* |

## 2. Tooling

Two scripts in `packages/db/scripts/`, run from `packages/db`. Both need the root `.env`.

| Step | Command | What it does |
| --- | --- | --- |
| 1. Export | `pnpm bubble:export` (add `-- --env live` for the live app) | **Read-only.** Downloads every Bubble data type to `packages/db/.bubble-export/<env>/` — gitignored, because it holds real emails and phone numbers. Drops the plaintext `created pass` and the WhatsApp credentials before writing. |
| 2. Import | `pnpm import:from-bubble` (dry run) / `pnpm import:from-bubble -- --commit` | Replaces the database's business data with the snapshot in **one transaction**. The dry run does everything, including verification, then rolls back. |

Environment: `BUBBLE_API_TOKEN` (Bubble editor → Settings → API → API Tokens) for the export;
`DATABASE_URL` for the import, plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for `--commit`.

**Why the export pages the way it does.** Bubble's Data API returns zero results past `cursor=50000`
while still reporting records remaining — no error. `dailypickproduct` has ~100K rows, so a plain
cursor loop silently stops at half. The export pages in windows of at most 10,000 ordered by
`Created Date`, de-duplicates by `_id`, and fails unless the unique count equals Bubble's own total.

**What a `--commit` run does, in order:**

1. Writes a JSON backup of everything it will delete — including `auth.users` and
   `auth.identities`, so password hashes — to `packages/db/.bubble-export/backups/`.
2. Creates one Supabase Auth login per imported user through the Admin API, with a random password
   nobody sees. (Auth logins cannot join a Postgres transaction.)
3. In one transaction: locks the core tables against other writers, deletes the current business
   data, inserts the snapshot, fills `_bubble_migration_id_map` / `_bubble_migration_log`
   (migration 0026), and runs the § 7 checks.
4. If the transaction fails, deletes the logins it created in step 2.

Never deleted: `notification_templates` seeded by migrations, `notification_settings`,
`alert_types`. `scripts/migrate-from-bubble.ts`, the earlier partial script, is superseded by these
two.

## 3. Findings from the live data that changed this plan

**a. The source audits five session types, not two.** `docs/ARCHITECTURE.md`'s lifecycle-engine
section and `reference/prd/lifecycle-invariants.md` both stated "phases 1 and 2 are not audited in
the source either" (only `close_shop`/`end_the_day` sessions exist). The live `session` table
shows five distinct values: `initiate day`, `open shop`, `close shop`, `end the day`, and `update`
(an ad-hoc type from mid-day edit workflows). That written claim was wrong, or true of an earlier
app version — ground truth from the live data overrides it. `lifecycle_session_type` is extended
with `historical_initiate_day`/`historical_open_shop`/`historical_update` (0027) purely so the
migration can preserve this full history without lossy remapping. **This rebuild's own functions
still only ever write `close_shop`/`end_the_day`.**

**b. `mainalert`'s real templates, and the triggers behind them — now fully built.** Prompt 9's
`notification_templates`/`substitute_template_placeholders` originally implemented only the four
tokens the PRD's `close-arrangement-phase-4-terminal.md` names (`%FIRST_NAME%`, `%ORDER_DETAILS%`,
`%CURRENT_OPEN_BUSINESS_DAY%`, `%NL%`); the live `mainalert` table's 11 rows also used `%COMPANY%`,
`%PICKUP_TIME%`, `%COMPANY_USER_FULL_NAME%`, `%PRODUCT_NAME%`, and `%PRODUCT_OVERBOOKING%`.
`substitute_template_placeholders` (0031) was extended with `%COMPANY%`/`%PRODUCT_NAME%`/
`%PRODUCT_OVERBOOKING%` (the three the built triggers actually needed); `%PICKUP_TIME%`/
`%COMPANY_USER_FULL_NAME%` were never needed since ids 6/8's rebuilt triggers use simplified wording.
**All 11 rows have a real, built trigger:**

| id | Content (paraphrased) | Status |
| --- | --- | --- |
| 1, 2 | Grower pick reminder ("please update your pick estimate") — identical duplicate rows, one shared trigger | **Closed.** `send_pick_reminder` (0029) writes a `notification_outbox` row (`template_key = 'pick_reminder'`). |
| 3 | "COMPANY updated their pick estimate" (to backoffice) | **Closed.** `update_pick_product_pallets` (0031) enqueues `pick_updated` — only when the grower made the edit. |
| 4 | "The shop is now open for orders" (to customers) | **Closed.** `open_shop` (0031) enqueues `shop_open`. |
| 5 | "This is a reminder to send an order for day X" (to a customer) | **Closed.** `send_order_reminder` (0028). |
| 6 | "COMPANY sent an order via USER — here's their current status" (to backoffice) | **Closed.** `submit_order` (0031/0032) enqueues `order_submitted` — direct customer submissions only. |
| 7, 9 | Arrangement summary to a grower / customer | **Functionally closed, differently.** `close_arrangement_grower`/`close_arrangement_customer` templates. |
| 8 | Arrangement summary to a grower, "also sent to the transporter" | **Closed.** `build_notification_outbox` (0031) cc's the grower's `transporter_company_id`. |
| 10 | "All picked pallets for PRODUCT ordered — N more pallets of overbooking room remain" | **Closed.** `submit_order` computes it live — `stock_overbooking_reached`. |
| 11 | "All pallets + overbooking for PRODUCT ordered — no longer orderable" | **Closed.** Same live computation — `stock_fully_exhausted`. |

**d. "Notify backoffice" needed one consistent addressing pattern.** Backoffice is a role, not a
single company. `enqueue_backoffice_notification` (0031, internal-only) is the one pattern every
backoffice-addressed trigger (ids 3, 6, 10, 11) reuses: one outbox row per **active backoffice
company**. `companies.transporter_company_id` (self-referencing FK, added 0031) was needed for id 8.

**c. `arrangement_records` has no historical order-line link to migrate from.** The source's
`dailyarrangementrecords` links a pick product to a customer *company*, never a specific
`dailyorderproducts` row — the gap Prompt 8 closed by adding `daily_order_product_id` as a real,
`not null` foreign key. A historical record therefore has to be **matched, not read directly**, to
the customer's order line (trading day + product variety + customer). § 4 gives the rule the import
uses; in the imported data every match was unambiguous.

## 4. How Bubble records become rows

Option-set values arrive as their Hebrew display text; any value the importer does not know stops it
before it touches the database. Bubble stores dates as UTC instants; trading dates and times of day
are read in **Asia/Jerusalem** (6 April is `2026-04-05T22:00:00Z` in Bubble).

| Bubble | This schema | Rule |
| --- | --- | --- |
| `company` | `companies` | Type and Status mapped from Hebrew; no Status → inactive. `Default Pickup Time` → its Israel time of day. `Transporter` → `transporter_company_id`. `Products in season` → `grower_products` (growers only). |
| `user` | Auth login + `profiles` | Email trimmed and lower-cased. Role משווק / מנהל מערכת → backoffice. Transporter logins (מוביל) are not imported — transporters never sign in. A phone number containing letters is left empty. `must_change_password = true` for everyone. `Products Blacklist` blocks whole families; each becomes every current variety of that family in `profile_blocked_products`. |
| `productfamily` | `product_families` | First of `Product Categories` → `category`; `image` → `image_url` with `https:` added. |
| `productvarieties` | `product_varieties` | `Variety` → `name` (Bubble's `Name` repeats the family), `Size` → `sizes`, `Overbooking` → `no_overbooking`, `In season` → `is_seasonal_available`, `No. of pallets per wholesaler` → `number_of_orders_per_customer` (0 → no cap, § 5). |
| `dailyarrangement` | `trading_days` + `daily_arrangements` | One trading day per arrangement — "initiate business day" is what creates one. A second Open arrangement for the same date created within a minute of another is a double-click and is merged into it. |
| `dailyshop` | `daily_shops` | Attached to the trading day with its date; when a date was initiated more than once, to the latest of those days initiated at or before the shop was created. A day keeps its first shop. Unset `can see prices?` → false (Bubble reads unset as no). |
| `dailypick` | `daily_picks` | Same date rule. On a closed day the status is closed. `pickup_time` = Bubble's `Pickup Time` once submitted or closed, null while draft (migration 0043). |
| `dailypickproduct` | `daily_pick_products` | Only the **real** record of each real/temp pair: the grower screen edits the temp copy and copies it to the real one on confirm. Bubble's `leftovers` is the carry-in from the grower's previous day, and "the number of leftover pallets after the day ended" is picked + carry-in − arranged — the same two meanings `leftover_pallets` has since migration 0050 — so an open day gets the carry-in and a closed day the end-of-day figure. |
| `dailyorder` | `daily_orders` | Day from the order's own shop link, otherwise the date rule. |
| `dailyorderproducts` | `daily_order_products` | `No. of pallets (new)` → `pallets_ordered`. Rows with no order are Bubble's blank per-variety placeholders and are skipped. A 0-pallet line is kept only if an arrangement record points at it — the only kind of zero line this schema has. |
| `dailyarrangementrecords` | `arrangement_records` | Day from its pick line. Its order line is the customer's line for that variety on that day (§ 3c). If the customer never ordered the variety, a 0-pallet line is created — what `arrange_to_customer` (0040) does — and if the customer had no order that day at all, an empty open order. Records with no quantity are skipped. |
| `dailyorder` → `order logs` | `order_submission_logs` | Bubble's log text is missing one comma; it is repaired, then stored in the shape `submit_order` writes: `[{ productVarietyId, palletsOrdered, comment }]`. An empty quantity → 0. |
| `session` | `lifecycle_sessions` | Types map to `close_shop` / `end_the_day` / `historical_*` (0027). An "initiate day" session is logged seconds before its arrangement, so it belongs to the day created just after it; the others to the latest day created before them. Bubble ids are kept in `metadata`. |
| `mainalert` | `notification_templates` | Imported as `bubble_mainalert_<id>`. No trigger reads them (§ 3b). |

Actions whose actor Bubble does not identify — records created in the Bubble editor, or by a login
that is not imported — are credited to the account named in Bubble's app settings as "assigned
distributor for reset password".

## 5. Decisions (made with James, 2026-09-16)

1. **Source:** Bubble test (staging), not live.
2. **Replace** the hosted project's demo data rather than import alongside it.
3. **Everything** is imported, not only reference data.
4. **The distributor's company.** "הרפז שיווק" is an inactive *grower* in Bubble with no picks or
   orders. It is imported as the active **backoffice** company, and all three distributor logins
   belong to it (one had no company). Backoffice notifications go to active backoffice companies.
5. **Open days.** Bubble's live day, 2026-04-07, stays open (shop open). The seven other days left
   Open were abandoned test runs; this schema allows one open day, so they are imported as closed,
   with their picks marked closed.
6. **Empty shops** are skipped: 47 from Jan–Feb 2025 (before arrangements existed; no picks or
   orders) and 9 repeat shops on days that already had one (no orders).
7. **A per-customer cap of 0 → no cap.** This app reads 0 as "may order nothing", but 7 of the 9
   varieties with a 0 cap were ordered normally in Bubble (up to 12 pallets a line).
8. **WhatsApp stays on** (`notification_settings` untouched). The Bubble test companies all share
   one real WhatsApp group id; only the Edge Function's `WHATSAPP_ENV` not being `live` keeps
   messages on the dev phone.

## 6. Result of the 2026-09-16 import

From the Bubble test export taken 2026-09-15T16:43Z.

| Bubble records | | Imported rows | |
| --- | ---: | --- | ---: |
| `company` | 86 | `companies` | 85 |
| `user` | 83 | logins + `profiles` | 72 |
| `productfamily` | 102 | `product_families` | 102 |
| `productvarieties` | 899 | `product_varieties` | 899 |
| `company` → `Products in season` | 182 | `grower_products` | 182 |
| `user` → `Products Blacklist` (families) | 2 | `profile_blocked_products` (varieties) | 31 |
| `dailyarrangement` | 324 | `trading_days` / `daily_arrangements` | 323 / 323 |
| `dailyshop` | 327 | `daily_shops` | 271 |
| `dailypick` | 8,072 | `daily_picks` | 8,072 |
| `dailypickproduct` (half are temp copies) | 100,574 | `daily_pick_products` | 50,273 |
| `dailyorder` | 5,518 | `daily_orders` | 5,522 |
| `dailyorderproducts` (18,824 blank placeholders) | 20,301 | `daily_order_products` | 1,488 |
| `dailyarrangementrecords` | 725 | `arrangement_records` | 673 |
| `dailyorder` → `order logs` entries | 121 | `order_submission_logs` | 121 |
| `session` | 737 | `lifecycle_sessions` | 737 |
| `mainalert` | 11 | `notification_templates` | 11 |

Every record that was skipped, created, or imported with a caveat has a row in
`_bubble_migration_log`; `message` starts with a code such as `[pick_line.over_arranged]`. The
groups worth knowing:

- **Kept as in Bubble, but inconsistent there:** 105 pick lines have more pallets arranged than
  picked plus carried in — 99 of them never had a pick estimate entered.
- **Not importable:** 14 pick lines whose variety was deleted (13 all zero, one with 1 pallet),
  4 arrangement records with no pick line, 1 customer login with no company, 1 nameless company
  nothing referenced.
- **Created to hold arrangement records:** 57 zero-pallet order lines and 4 empty open orders.
- **No column in this schema, so not carried over:** company address, city, tax id, phone,
  accounting id, external code, main contact and logo; "Should not receive arrangement?" (set on
  14 companies — they now receive arrangement messages like everyone else); order-level comments
  (21, full text kept in the log); order and pick activity history; `productleftover`; app settings.

## 7. Verification

Inside the transaction, before anything commits — a failure rolls the whole import back:

- every table's row count equals the plan, and `auth.users` holds exactly the imported logins;
- exactly one trading day is not closed — the live day;
- the totals of `pallets_picked`, `leftover_pallets`, `pallets_ordered` and `quantity_pallets` equal
  the plan, which catches a value lost in conversion that a row count cannot;
- ten cross-table checks, each of which must find zero rows: an arrangement record's customer is its
  order line's customer; its pick line, order line and arrangement are on one trading day; its pick
  line and order line are the same variety; zero-pallet order lines exist only under an arrangement
  record; every trading day has its arrangement; a closed day's arrangement, shop and picks are all
  closed; a shop is open exactly when its day is in `shop_open`; picks belong to growers and orders
  to customers; every login has a profile; an active backoffice company exists.

## 8. After the import

- **Every imported user must reset their password** — through the admin reset on the Users screen.
  Bubble never exposes password hashes, so there is no way to carry them over.
- Nobody could sign in straight after the import, so a backoffice login for the developer (James)
  was added on the distributor company, provisioned like any admin-created account.
- Password-reset links can only redirect to the Supabase project's Site URL,
  `http://localhost:3000` (the local dev server): the Redirect URLs allow-list is empty. Until the
  deployed site's URL is added there (Supabase dashboard → Authentication → URL Configuration), a
  reset started from the deployed site also lands on localhost.
- The `SAMPLE_LOGIN_*` accounts in `.env` no longer exist. Only the seed scripts in
  `packages/db/scripts/` used them.
- The domain and e2e suites create their own fixtures rather than using the demo accounts, but they
  have not yet been re-run against the imported data.
- The 2026-04-07 live day is open in phase `shop_open`, dated in the past relative to the import.
