# Schema Decisions

A running log of non-obvious decisions made about `packages/db`'s schema — the "why," not the
"what" (the schema itself is the source of truth for that). Newest entries first.

---

## 2026-09-10 (latest) — Pick status gains a deliberate backward transition: Submitted → Draft,
## backoffice-only, from the arrangement board

**Context.** `reference/prd/state-machines/pick-status-state-machine.md` documents the Daily Pick
state machine as strictly forward-only (Draft → Submitted → Closed), "no backward transitions
exist in any UI" — accurate for the source app, and for this rebuild up to this point
(`packages/domain/src/lifecycle-engine/lifecycle.test.ts` has a test literally titled "submit_pick
is forward-only and grower-scoped"). Stakeholder direction now adds one, deliberately: a truck icon
beside the pencil in `GrowerSupplyColumn` (the arrangement board's grower list) lets the
distributor revert a grower's Submitted pick back to Draft while the trading day is still open —
e.g. the grower submitted prematurely, or the distributor wants to keep editing before treating the
lot as final. This does not change the *reference* doc (that still describes the source app's own
behavior, synced from the external PRD tool); it's recorded here as a deliberate, later divergence
in this rebuild's own implementation.

**What changed (`packages/db/migrations/0044_revert-pick-to-draft.sql`).**

- **`revert_pick_to_draft(p_daily_pick_id)`, new, backoffice-only** (not "the owning grower, or
  backoffice" like every other function in this module — this is a distributor-side arrangement-
  board control, not something exposed on the grower's own picking screen). Only accepts a pick
  currently `'submitted'` (raises `INVALID_STATE`/P0007 otherwise) — since `close_arrangement`
  mass-closes every pick to `'closed'` when the day ends, a pick can only ever be `'submitted'`
  while its trading day is still open, so this one check is equivalent to "day still open" without
  a separate phase lookup.
- **Clears what `submit_pick` set**: `status` back to `'draft'`, `submitted_at` back to `null`, and
  — because of the pickup-time snapshot from the entry below — `pickup_time` back to `null` too. A
  later re-submission re-snapshots whatever the grower company's default is AT THAT POINT, which is
  the whole reason 0043 made it a snapshot instead of a live join in the first place.
- **`close_arrangement`, extended again**: the mass pick-close now also backfills `submitted_at`
  (`coalesce(dp.submitted_at, now())`) alongside the existing `pickup_time` backfill, for any pick
  that reaches Closed without ever going through `submit_pick` — a genuine no-show, or one the
  distributor reverted with the truck icon and never got re-submitted. Every closed pick now carries
  a real submission timestamp, not a null one for the picks that arrived here sideways.

The arrangement-board UI (`GrowerSupplyColumn`) hides the toggle entirely once a pick is `'closed'`
— there's nothing left to flip — and disables it whenever the screen's own `editable` flag
(trading day live + arrangement still open) is false, the same gate every other write control on
that screen already uses.

---

## 2026-09-10 — Pickup time moved from per-product to per-grower, with a
## submission-time snapshot for historical accuracy

**Context.** `daily_pick_products.pickup_time` (0014) modeled pickup time as an optional
per-line override of `companies.default_pickup_time` — stakeholder feedback confirmed this was
simply wrong: a grower has one collection time for the whole day, not one per variety on their
pick. The per-line override and its editing surface (a `type="time"` input per row in
`PickLinesEditor`) are removed entirely.

**What changed (`packages/db/migrations/0043_grower-pickup-time.sql`).**

- **`daily_pick_products.pickup_time`, dropped.** `update_pick_product_details` now edits only
  `comment` (its 3-arg signature is replaced with a 2-arg one via an explicit `drop function` —
  see the "real, silent bug" entry below for why that step can't be skipped). `save_pick_lines`
  (0039)'s per-line JSONB shape drops `pickupTime` the same way.
- **`daily_picks.pickup_time`, added** — not a live join to `companies.default_pickup_time`, but
  a snapshot of it, so a later edit to the company's default cannot rewrite a past day's record.
  This is the direct answer to "we should be able to see the pickup time of past records."
  Written at exactly the two moments a pick can leave Draft:
  1. **`submit_pick`** — the grower's own Draft → Submitted action copies the company's current
     `default_pickup_time` in at that moment.
  2. **`close_arrangement`**'s mass pick-close — a pick that never gets submitted (a no-show
     grower, force-closed at Phase 4 per Invariant 4) never runs `submit_pick`, so the same
     backfill happens there instead, guarded with `coalesce(dp.pickup_time, c.default_pickup_time)`
     so an already-submitted pick's own snapshot is never overwritten.
- While still in Draft, `daily_picks.pickup_time` is null and every read path (the arrangement
  board's `buildBoard`, the Grower Inventory Status oversight screen) falls back to the live
  `companies.default_pickup_time` — there is nothing to snapshot yet, so showing the live value
  is correct, not a bug.
- `FamilyGroupedLines`' `secondary` field (the per-line pickup-time label on the oversight
  screen's read view) is removed outright rather than left unset: it was already unset for order
  lines, and removing the grower side left nothing that ever populated it. The oversight screen
  (`distributor-grower.tsx`) now shows the grower's collection time once, in the row's caption,
  next to (not instead of) the submission-time/closed status text it already showed.

See `packages/domain/src/lifecycle-engine/lifecycle.test.ts`'s four-phase walkthrough for the
snapshot behavior proven end to end: a submitting grower's pick keeps the company default it had
at submission time, and a no-show's pick picks up the same backfill through `close_arrangement`.

---

## 2026-07-12 — The remaining six mainalert triggers: one backoffice-addressing pattern,
## live-computed stock alerts, and a transporter cc — no new dispatch mechanism

**What changed.** Every `mainalert` id `docs/DATA_MIGRATION_PLAN.md` still listed as unbuilt (ids 3,
4, 6, 8, 10, 11 — id 5 and ids 1/2 were already closed by the two entries below) is now a real
trigger, all through the existing `notification_outbox`/`resolve_outbox_dispatch` pattern from
Prompt 9. See `docs/ARCHITECTURE.md`'s "The remaining six mainalert triggers" section for the full
account. Summarized here as schema-level decisions:

- **`enqueue_backoffice_notification`** (0031) — one internal helper, reused by all four
  backoffice-addressed triggers (ids 3/6/10/11), rather than four independent "which companies count
  as backoffice" queries. Deliberately has no `grant execute ... to authenticated`: it's only ever
  called from within another `security definer` function's own execution context (the same RLS-
  bypass `order_submission_logs` already relies on for its own no-INSERT-policy table), never a
  legitimate direct client RPC target. Granting it broadly would let any authenticated caller enqueue
  an arbitrary `template_key`/payload addressed to backoffice.
- **`companies.transporter_company_id`** (0031, self-referencing FK, RESTRICT) — needed for id 8's
  transporter cc. A genuine, pre-existing PRD gap: `reference/prd/company.md`'s own field table never
  listed it, despite the live `company.Transporter` field being populated on real grower rows.
- **ids 10/11 stay live-computed, deliberately.** `get_orderable_catalog_for_customer`'s own design
  already rejected a stored out-of-stock list once (0018's header comment: the source's CREATE-vs-
  UPDATE trigger bug came from exactly that pattern). `submit_order` computes both crossings inline,
  comparing global demand before/after its own line writes, for only the varieties whose pallet count
  could have increased this call — no new table, no trigger.
- **`substitute_template_placeholders` gained one genuinely new token, `%COMPANY%`**, distinct from
  `%FIRST_NAME%` — the recipient's own identity vs. a third party the message is *about* (the grower
  who updated their pick, the customer who submitted). Plus `%PRODUCT_NAME%`/`%PRODUCT_OVERBOOKING%`
  for ids 10/11. Both changes are additive with defaults, so every existing template/call site is
  unaffected.
- **A real, silent bug found and fixed while extending that function.** `create or replace function`
  only replaces a function when its argument list matches exactly — adding parameters (even with
  defaults) creates a dead second overload instead of actually replacing the original. This had
  already happened, unnoticed, when `get_orderable_catalog_for_customer`/`submit_order` picked up
  `p_customer_company_id` in the prior entry below: both original signatures were still sitting in
  the schema, unreachable but present. Cleaned up via explicit `drop function if exists` before this
  migration's own signature change, so the same mistake wasn't repeated.

---

## 2026-07-12 — send_pick_reminder wired to dispatch, closing the asymmetry the previous
## entry left open

**What changed.** `send_pick_reminder` (`packages/db/migrations/0015`) stamped `daily_picks.
reminder_sent_at` but never dispatched anything — a deliberate stub at the time, since the
notifications module didn't exist yet ("no integration exists yet; see the notifications module").
The entry below built `send_order_reminder` with real dispatch and left retrofitting
`send_pick_reminder` as "a separate, still-open decision — not done here." `packages/db/migrations/
0029` closes it: `send_pick_reminder` now also writes one `notification_outbox` row
(`template_key = 'pick_reminder'`), using the identical pattern — same row lock, same
not-already-closed check, same `lines: []` payload convention. The seeded `pick_reminder` template
content is adapted from the live `mainalert` ids 1 and 2 (identical duplicate rows: "please update
your pick estimate for day X"). Tested the same way `send_order_reminder` was: one domain test
asserting both `reminder_sent_at` is stamped **and** exactly one outbox row with the right
`template_key`/`recipient_type`/`trading_day_id` exists (`packages/domain/src/grower/
grower.test.ts`) — the earlier version of this test only proved the role guard and the stamp, not
the dispatch, since dispatch didn't exist yet.

No RLS change, no new function — same signature, same `security invoker` + `current_role()`
pattern, just a `create or replace` extending the body. Both reminder functions (`send_pick_
reminder`, `send_order_reminder`) now behave identically end to end.

---

## 2026-07-12 — Customer Order Status screen: extending two deliberately customer-only
## functions with a backoffice-gated parameter, not a second write/read path

**Context.** `/backoffice/distributor-customer` (Customer Order Status) needed to reuse
`get_orderable_catalog_for_customer` and `submit_order` (both from `packages/db/migrations/0018`)
so a backoffice session could read/edit a specific customer's order — the same "reuse the existing
component/function, don't build a second path" precedent the grower module already established
(`update_pick_product_pallets`/`_details` already accept "the owning grower, or backoffice").
Neither customer-module function had that path yet, and one of them had an explicit reason not to.

**`get_orderable_catalog_for_customer` had a deliberate anti-spoofing design, not just an
oversight.** Its own comment (0018) explains it takes no target-company parameter *at all* — not
"takes one but RLS would filter it," but "there is no way to pass another company's id... not
accepting it as a parameter at all removes the spoofing surface entirely." Casually adding an
unchecked parameter would have quietly reversed that decision. Instead, `packages/db/migrations/
0028` adds an optional `p_customer_company_id`, converts the function from `language sql` to
`language plpgsql` (needed to add a real conditional check), and raises `FORBIDDEN` (`42501`)
outright if any non-backoffice caller supplies a non-null value — preserving the original "not
just RLS-filtered, actively rejected" intent while adding the new capability. Every existing
customer call (parameter omitted) runs the identical query against `current_company_id()`, byte-
for-byte unchanged.

**`submit_order` gets the same optional, backoffice-gated `p_customer_company_id`.** Unlike the
catalog function, this one didn't have a stated anti-spoofing rationale to preserve — it was just
strictly `current_role() = 'customer'` with no on-behalf-of path, a real asymmetry with the grower
module's equivalent functions. `order_submission_logs.submitted_by` is deliberately left reading
`auth.uid()` regardless of which path was taken — it records who actually clicked submit (the
distributor, when acting on a customer's behalf), never the order's owning company, matching how
the grower module already attributes on-behalf-of edits to the real actor rather than the record
owner.

**`daily_orders.reminder_sent_at`, added** — mirrors `daily_picks.reminder_sent_at` exactly, set by
the new `send_order_reminder` function. At the time, unlike `send_pick_reminder` (a Prompt-6 stub
that deliberately didn't dispatch anything because the notifications module didn't exist yet),
`send_order_reminder` had no such excuse — Prompt 9 already built the outbox — so it also wrote a
real `notification_outbox` row (`template_key = 'order_reminder'`). `send_pick_reminder` was
retrofitted to dispatch the same way in a follow-up pass — see the entry above.

**The `mainalert` id-5 gap, closed.** Prompt 10's migration plan grouped `mainalert` id 5 with ids
1/2 as "grower pick-reminder messages" — re-verified against the live `mainalert` rows while
designing this function and found that grouping wrong: id 5's actual content ("this is a reminder
to send an order for day X") is the *customer* order reminder, not a grower message. `send_order_
reminder`'s seeded `order_reminder` template content is adapted from that row. `docs/
DATA_MIGRATION_PLAN.md` § 3b is corrected in place with the full row-by-row mapping; ids 1/2 (the
actual grower pick reminder) and id 6 (order-submitted-to-distributor, the opposite direction) are
confirmed still genuinely separate, unbuilt gaps.

No new RLS policy needed anywhere in this entry — `daily_orders`/`daily_order_products`/
`arrangement_records` backoffice-read/write policies already existed (0010/0017); the two extended
functions and the one new function each do their own explicit role check internally, the same
`security invoker` + `current_role()` pattern every other backoffice-gated function in this schema
already uses.

See `docs/ARCHITECTURE.md`'s "The three screens Prompt 10 flagged as gaps" section for the full
account, including `/profile` and `/backoffice/order-history` (neither needed a schema change).

---

## 2026-07-12 — Notifications: Alert Types and main alert verified as genuinely
## different, not merged; Alerts' privacy gap closed as RLS from the start

**Context.** The source stores outbound-notification templates in two places: an
admin-configurable "Alert Types" bank, and a separate "main alert" lookup table WhatsApp dispatch
pulls by id. `reference/prd/alerts-and-alert-templates.md` itself flags the relationship between
them as a `[GAP]` — "likely they are parallel template stores serving different code paths,"
unconfirmed. This task required actually checking that before merging them into one table, not
assuming the merge was safe.

**The verification.** Comparing the PRD's own field tables directly:

| | Alert Types | main alert |
| --- | --- | --- |
| Body | `Main Text` + `Second Line Of Text`, no placeholder syntax | `alert content`, one string with `%FIRST_NAME%`/`%ORDER_DETAILS%`/`%CURRENT_OPEN_BUSINESS_DAY%`/`%NL%` tokens |
| Navigation | `App Screen` + `Parameter To Send` — structured in-app route | `link` — a raw outbound URL string embedded in an external message |
| Consumed by | Alerts (a persisted delivery-log row, read/unread, in-app) | WhatsApp dispatch only, at message-composition time — produces no delivery record of its own |
| Selected how | Admin-authored, presumably many rows, chosen when an Alert instance is created | A small, stable set referenced by a code-known id, hardcoded into workflow logic (e.g. `close_arrangement`) |
| Extra field | — | `notification type` (channel targeting) |

Five genuine differences, not one. Alert Types' fields make sense as *structured data the client
renders directly* (a UI can lay out "main text: name — number" however it wants, no string
templating needed); main alert's fields make sense as *a flat string a find/replace has to
produce*, because a WhatsApp message is inherently one block of text. Merging them would mean
picking one shape and awkwardly bending the other's use case to fit it. **Verdict: keep separate.**
`alert_types` (`packages/db/src/schema/alert-type.ts`) is Alert Types, unchanged in shape.
`notification_templates` (`packages/db/src/schema/notification-template.ts`) is `main alert`,
renamed for clarity — nothing here is a Bubble "alert" in the in-app sense, it never produces a
delivery-log row.

**What's new.**

- **`alerts`** (`packages/db/migrations/0023`) — the delivery log. RLS is `intended_for_user_id =
  auth.uid()` on `select` and the mark-as-read `update`, with **no** `insert`/`delete` policy for
  `authenticated` at all; every row is written by `create_alert` (`security definer`,
  backoffice-only caller — `packages/db/migrations/0024`), matching `order_submission_logs`'
  closed-to-raw-writes shape. This is the explicit fix for the source's own documented gap
  ("Alerts... likely defaults to 'everyone'... too permissive") — implemented as the RLS policy
  itself, not an application-level `.eq("intended_for_user_id", ...)` a future query could forget
  to add.
- **A real bug in that same RLS pass, caught by the e2e spec, not the unit test.** `alert_types`
  was originally locked to backoffice-only for `select` too — but a user's own client needs to
  read the `alert_types` row an Alert references (`main_text`, `app_screen`, ...) to render it,
  under THEIR session, not backoffice's. With no policy granting that, the embedded PostgREST
  join (`alerts.select("*, alert_types(...)")`) silently resolved to `null`: the Alert row itself
  was visible (Alerts' RLS already permits that), but rendered as an empty button with no
  navigation target. The domain-level RLS test didn't catch this — it exercises `.rpc()`/
  `.from()` directly, never the embedded join a real page actually issues. `apps/web/e2e/
  alerts.spec.ts` did, immediately. Fixed in `packages/db/migrations/0025`: `alert_types` now
  allows `select` for any authenticated user (it holds no tenant-sensitive data — admin-authored
  copy and a route string — the same shape as `product_families`), keeping writes
  backoffice-only. Lesson for future privacy-boundary work in this project: an RLS test that only
  calls the table directly is not sufficient proof a real page renders correctly — a joined read
  needs at least one test (unit or e2e) that actually performs the join.
- **`notification_outbox` (Prompt 8) gets the retry/observability columns it was deliberately
  left without.** `attempt_count`/`last_error`/`last_attempted_at`, plus `template_key` so
  `resolve_outbox_dispatch` knows which `notification_templates` row to compose from. Not a
  foreign key on purpose — a template that hasn't been authored yet surfaces as a clear
  `NOT_FOUND` at dispatch time, not a constraint blocking the `close_arrangement` transaction that
  wrote the row.
- **`notification_settings`, a genuine singleton, not the R2 anti-pattern.** Two booleans
  (`whatsapp_enabled`, `close_arrangement_whatsapp_enabled`), checked at drain time rather than
  when `close_arrangement` writes the outbox row — the row is always written transactionally
  regardless of toggle state, and the drain job decides whether to actually send. `id boolean
  primary key default true, check(id)` makes a second row structurally impossible.
- **`profiles.phone_number`, added.** The source's edit-profile screen already treats phone as an
  editable field (`reference/prd/edit-profile.md`), and it's the source of the
  individual-WhatsApp-dispatch batch (`close-arrangement-phase-4-terminal.md` action 8: no
  `group_id` → per-user phone, 972-prefixed, leading 0 stripped) — this schema had no phone
  number field anywhere until this prompt. Nullable: a user with none on file is simply
  unreachable by that batch, not an error.

See `docs/ARCHITECTURE.md`'s notifications module section for the full account, including why the
actual business logic (recipient resolution, placeholder substitution) lives in Postgres rather
than in the Edge Function's Deno code.

---

## 2026-07-11 — Arrangement: a real order-line link the source never had; one
## transaction replaces close_arrangement's nine-action WhatsApp/pricing sequence

**Context.** The source's `dailyarrangementrecords` (confirmed via the Bubble Data Dictionary —
`mcp__st4ck-pm__search_prd`) links a `daily_pick_record` (supply) to a `linked_to_company`
(demand) — a customer *company*, never a specific `daily_order_product` line. Two order lines
for the same variety from the same customer on the same day are indistinguishable to an
arrangement record; the only way to tell them apart is by re-deriving which one "must" be meant,
which is exactly the kind of implicit coupling this schema tries not to have. Separately, the
source's `close_arrangement` backend flow (`close-arrangement-phase-4-terminal.md`) is nine
separate actions — create session, seven App Settings field resets, a WhatsApp-eligibility
boolean, the arrangement status change, mass pick-close, a price-fluctuation flag reset, two
WhatsApp dispatch batches (company-group vs. individual), and a separately-triggered `populate
prices` custom event — with a documented, deliberately-not-preserved idempotency bug: a
double-click resends WhatsApp and creates a duplicate session.

**What changed.**

- **`arrangement_records.daily_order_product_id`, added.** A new `not null` FK to
  `daily_order_products`, `on delete cascade` (`packages/db/migrations/0020`). This table had
  zero real rows at the time (only ever torn-down test fixtures), so the column was added
  directly, no backfill needed. `customer_company_id` is kept alongside it — not because the
  order line doesn't already imply the customer (it does, via `daily_order_id` →
  `daily_orders.customer_company_id`), but because RLS and the notification-outbox aggregation
  both filter/group by customer company directly, and a stored, set-once-at-create-time column
  avoids an extra join on every one of those queries. `price_type` was also added, nullable —
  a snapshot of which price type actually produced `price`, populated either by an explicit
  per-record override at create/update time or by `close_arrangement`'s own pricing step.
- **`check_arrangement_allocation`, one function, not two.** `create_arrangement_record` and
  `update_arrangement_record` (`packages/db/migrations/0021`) both call the same internal guard
  rather than each carrying their own copy of "sum every other arrangement record against this
  line and compare to its ceiling." `update_arrangement_record` passes its own record's id as
  an explicit exclusion, so re-affirming or lowering a quantity never trips the very ceiling
  it's already counted against. Raises a new error code, `OVER_ALLOCATION` (`P0009`) — the PRD's
  own test-implications note for the New Arrangement wizard calls out that over-allocation
  "should be blocked or warned"; this makes it a hard block, consistent with every other
  business-rule violation in this schema being a raised exception, not a silent clamp.
- **`notification_outbox`, replacing the source's synchronous WhatsApp dispatch (Actions 7-8).**
  A plain table (`packages/db/migrations/0020`): `trading_day_id`, `recipient_type`
  (`grower`/`customer`), `recipient_company_id`, a `jsonb payload`, `created_at`, and a nullable
  `sent_at` a later drain job sets. `close_arrangement` writes to it directly — no outbound HTTP
  call happens inside the function's own transaction at all (R4's external-system carve-out), so
  a flaky WhatsApp API can never roll back a successful close. This also sidesteps the source's
  documented double-click bug structurally rather than by trying to reproduce its
  since-acknowledged-broken idempotency contract: `close_arrangement` already serializes on the
  trading day via `select ... for update` (Prompt 5), so a genuine concurrent double-call can
  only ever produce one outbox row, not two duplicate WhatsApp sends.
- **`close_arrangement`, extended via `create or replace`, not edited in place.**
  `packages/db/migrations/0022` adds two statements to the existing Phase-4 function body from
  `0015`: `populate_arrangement_prices` (fills any un-priced arrangement record from its
  variety's fixed price or price-range midpoint; raises `INVALID_STATE`/`P0007` — aborting
  everything in the same call, including the mass pick-close and leftover computation that ran
  earlier in the same function — if a record's variety has neither) and
  `build_notification_outbox`. The source's seven App Settings field resets and its separate
  WhatsApp-eligibility boolean computation have no equivalent here — there is no App Settings
  singleton to reset (R2), and the outbox's payload already carries `can_see_prices` per
  recipient at write time rather than gating the whole batch on one precomputed flag.

**Why price population had to move inside the transaction, not stay a separate triggered step.**
The source's "populate prices" was its own custom event, run after the arrangement status
already flipped to Closed — meaning a arrangement could be marked closed with stale or missing
prices if that second step failed or was skipped. Folding it into `close_arrangement`'s own
function body means a pricing failure prevents the close from happening at all, proven directly
(not just asserted) in `packages/domain/src/arrangement/arrangement.test.ts` by giving an
arrangement record a genuinely unpriceable variety, calling `close_arrangement`, and confirming
the trading day's phase, the arrangement's status, and every pick's status are still unchanged
afterward — the whole function body rolled back, not just the one statement that raised.

---

## 2026-07-11 — Customer ordering: one variety-level function replaces a two-bug OOS
## trigger pair; one transaction replaces a dash-packed 5-action save workflow

**Context.** v1.3's own tech spec (`get_spec_document` — "OOS architecture rework") documents
the exact history: a DB trigger (`update out of stock products to the shop (when editing
orders)`) gated on `OldDataItem._id is_not_empty`, which is false on Create — the first customer
to deplete a variety never updated the shop's out-of-stock list, so everyone else kept seeing it
as in stock. Separately, the customer order screen's family-level RepeatingGroup re-excluded an
entire product family the moment any ONE of its varieties appeared in the (already-stale)
out-of-stock list, even when a sibling variety in the same family was still available — "Lemon
100 = 0" could hide the whole Lemon family even with "Lemon 123 = 5" still in stock. Both bugs
share one root cause: propagated/duplicated filtering logic that drifts from the thing it's
supposed to agree with.

**What changed.**

- **No stored out-of-stock list, no trigger, at all.** `get_orderable_catalog_for_customer`
  (`packages/db/migrations/0018_customer-order-functions.sql`) computes orderability live, on
  every read — there is nothing to propagate and therefore no CREATE-vs-UPDATE trigger
  condition to get wrong. It delegates the actual cross-tenant supply-vs-demand aggregate
  (`total_supply = sum(pallets_picked) + sum(leftovers) + no_overbooking`,
  `total_demand = sum(pallets_ordered)`, both across ALL growers/customers for that
  date+variety — the PRD's own formula, unchanged) to `shop_variety_orderability`, a narrowly
  scoped `security definer` helper that returns only `(variety_id, boolean)` — never a raw pick
  or order row — so running it with elevated privileges can't leak one customer's or grower's
  data to another. This is the one place in the module that needs `security definer`, and it's
  deliberately as small as it can be.
- **Exactly one filter, at variety level — never a second one at family level.** The
  family-level RepeatingGroup constraint the source layered on top is not reproduced anywhere.
  `get_orderable_catalog_for_customer` returns one row per orderable-or-in-cart VARIETY; both
  the main order screen and the submission-confirmation popup group those rows into families
  purely as a client-side projection (`apps/web/src/components/customer/catalog-grouping.ts`).
  A family that has zero surviving variety rows simply never appears — not because a second
  filter excluded it, but because nothing added a row for it in the first place. This is also
  how the source's own "avoid rendering an empty family" goal was achieved for the *right*
  reason instead of the wrong one.
- **The per-customer carve-out is a session boundary, not a parameter.** A customer's own
  already-ordered variety stays visible to them even after it goes OOS. This works by reading
  `daily_orders`/`daily_order_products` under the CALLER's own RLS-scoped session (`security
  invoker` on the outer function) rather than accepting a customer-company-id parameter — there
  is no way to spoof another company's cart through this function, because the function never
  trusts anything but `current_company_id()` for that half of the query.
- **`submit_order`, replacing `save_order_line`'s dash-packed text parameter.** The source's
  workflow accepted `"<order-id>-<pallets>-<comment>-<line-id>"` and split on `-` — undocumented,
  and genuinely broken for any comment containing a dash (the comment gets truncated and later
  segments misassign to the wrong fields, an acknowledged real bug in the source, not one to
  reproduce). `submit_order` takes a typed `jsonb` array of `{productVarietyId, palletsOrdered,
  comment}` objects instead — no separator character, nothing to escape. One call
  upserts-and-prunes the customer's entire line set (same shape as `bootstrap_grower_pick`),
  sets the order to `submitted`, and writes one `order_submission_logs` row, all in one
  transaction — replacing the "processing flag flips on, N per-line workflow calls happen, the
  last one clears the flag" batching dance with a single round trip that either fully commits or
  doesn't happen at all.
- **`daily_order_status` corrected from a placeholder to the PRD's real states.** The lifecycle
  engine (Prompt 5) bootstrapped `daily_orders` with a scratch `open`/`closed` enum, explicitly
  deferred to this module. The PRD's own state-machine doc confirms only `Open` and `Submitted`
  are ever reached in the running platform — `Scheduled`/`Out for delivery`/`Received` are
  aspirational option-set values no workflow assigns. `alter type ... rename value 'closed' to
  'submitted'` was safe because nothing had ever written `'closed'` (only `open_shop`'s bootstrap
  insert touches this column, always at the default `'open'`).
- **No cron sweep for empty order lines.** The source runs an hourly `daily check for empty
  orders` job deleting stray zero-quantity `daily_order_products` rows — needed because the old
  per-line save path could leave them behind. `submit_order`'s prune step (delete any line not
  present at a positive quantity in the new submission) makes "a zero-quantity order line never
  persists" hold by construction, at write time, every time — there's nothing left for a
  periodic sweep to find.

**A test-cleanup FK-ordering bug, found and fixed, for the record.** `deleteTestUser`
(`packages/domain/src/auth/test-helpers.ts`) originally called Supabase's Auth admin
`deleteUser` and returned without checking the response for an error — a failed delete silently
left the `profiles` row (and its company, which has no cascade back from `profiles.company_id`)
orphaned, surfacing several `runCleanup` steps later as an unrelated-looking FK violation on a
completely different table. Getting a fully green run of `packages/domain/src/customer/
customer.test.ts` surfaced this repeatedly, as HTTP 500s from the Auth admin API — initially
suspected as Supabase-side resource pressure (no public incident, isolated retries sometimes
succeeded), but the actual cause was a real ordering bug in this test file: `order_submission_logs
.submitted_by` references `profiles.user_id` with no cascade (deliberate — the audit log outlives
the submitting user's own test lifecycle), and several of the file's tests pushed a submitting
customer's user-delete cleanup *after* the trading day's cleanup, so `runCleanup`'s LIFO unwind
deleted that customer's `profiles` row *before* the day's cascade had cleared the
`order_submission_logs` row pointing at it — a straightforward FK violation that GoTrue's own
internal `auth.users` → `profiles` cascade hit too, surfacing to the API caller as an opaque 500
rather than a clear constraint error. Fixed by pushing the day's cleanup after every sign-in that
might have called `submit_order`, not just after company creation. Confirmed with two clean,
back-to-back runs. `deleteTestUser` also picked up an error check, bounded retries, and a
direct-SQL fallback as a safety net for genuine transient failures — worth keeping regardless,
but not what actually fixed this incident. See `docs/ARCHITECTURE.md`'s customer ordering module
section for the full account.

---

## 2026-07-11 — Grower picking: one idempotent upsert replaces real+temp records; one
## named function replaces a three-workflow leftover chain

**Context.** Two replacements were the explicit point of this module, both named directly
against a documented source anti-pattern.

**`bootstrap_grower_pick`, replacing the real+temp record pair (R3).** The source recreates a
grower's picking lines for the day by writing one "real" row and one "temp" row per variety on
every rerun — the temp row is a scratch placeholder that every downstream query (notably the
out-of-stock supply formula) has to remember to filter out, and a `TerminateWorkflow` guard is
what actually makes reruns preserve existing pallet counts, not any property of the schema
itself. There is no `is_temp_record` column, or anything shaped like it, anywhere in this
project's schema. Instead:

- `insert into daily_pick_products (...) values (...) on conflict (daily_pick_id,
  product_variety_id) do nothing` is the whole "don't clobber what the grower already entered on
  a rerun" guarantee — a real database-level upsert, not an app-level check-then-write, and not
  a `TerminateWorkflow`-shaped early exit either.
- A companion `delete ... where not exists (matching grower_products row)` prunes lines for
  products that dropped out of season. This is the one place a *new* mechanism was needed
  (the source's temp-record approach never had to prune, since a stale line's temp counterpart
  just kept getting excluded by the same filter every downstream query already applied) — but it
  comes for free at the FK level: `arrangement_records.daily_pick_product_id` already has `on
  delete cascade` (set up in the lifecycle engine's 0012), so deleting an out-of-season line
  automatically cleans up any arrangement built against it, matching the source's separate
  documented "rerun-only cleanup of out-of-season arrangements" step without writing a second
  cleanup statement for it.
- `initiate_business_day` (Phase 1) was refactored to call this once per eligible grower instead
  of holding its own inline bootstrap `insert`s — the exact same function is also what the
  distributor's "add products" action calls (after `save_grower` updates the in-season list), so
  a mid-day catalog change gets a pick line immediately rather than waiting for the next full-day
  rerun to notice it.

**`close_out_pick_leftovers`, replacing a three-workflow trigger chain (R6).** The source
computes and propagates leftover pallet counts through three separately-triggered,
near-identically-named workflows — a DB trigger (`update left overs`) firing an API workflow
(`update_leftovers`) that itself triggers a second DB trigger (`update leftover data`) to
propagate aggregates. The PRD's own text calls this chain "a maintenance hazard." Replaced with
one named `plpgsql` function, `close_out_pick_leftovers(trading_day_id)`, doing the entire
computation (`pallets_picked - sum(arrangement_records.quantity_pallets)`, per line) in a single
`update`, called directly — a plain function call, not a trigger relay or a queue — from
`close_arrangement` (Phase 4), after picks are mass-closed so `pallets_picked` is final for the
day. Because a `plpgsql` function called from inside another runs in the same transaction by
default, this reuses R4's guarantee for free: no extra mechanism was needed to make "picks close,
then leftovers compute" atomic. This also collapses the source's two near-identical fields
(`Leftovers` and `Leftover Pallets After Day End` — genuinely the same number, computed at two
different points in an unnecessarily long pipeline) into one `leftover_pallets` column.

**`update_pick_product_details`, kept separate from `update_pick_product_pallets`.** The
grower's pickup-time override and comment are edited by a new function rather than folding them
into the existing (already-tested) pallets function, because the two guard genuinely different
things: `update_pick_product_pallets` enforces the arrangement-edit floor (a stateful business
rule), while `update_pick_product_details` has no such rule to enforce — it only needs the
"pick isn't closed yet" check. Both are `security definer`, matching `update_pick_product_pallets`'s
existing precedent: RLS grants growers no general write access to `daily_pick_products`, so a
`security definer` function with its own ownership check ("the owning grower, or backoffice") is
the sole write path for either. `bootstrap_grower_pick` and `close_out_pick_leftovers`, by
contrast, are `security invoker` with an internal backoffice-only check — the same shape as every
other backoffice-only lifecycle function, since there's no separate RLS rule being duplicated or
bypassed for those two.

**`bootstrap_grower_pick`'s prune step needed a data-loss guard — found by review, not by the
original test suite.** The original prune step deleted any `daily_pick_products` line whose
product had left `grower_products`, unconditionally. That's fine the first time
`bootstrap_grower_pick` runs for a (day, grower) pair (Phase 1, nothing has been picked or
arranged yet), but the function is explicitly re-invoked mid-day too — the distributor's "add
products" action calls it directly after `save_grower` changes a grower's in-season list, any
time in phases 1–3. By then a line the distributor is about to prune may already carry a real
`pallets_picked` value or an `arrangement_records` row. Deleting it unconditionally would
cascade-delete that arranged supply the moment someone unchecks a product, which is a correctness
bug the original test suite didn't catch because its one prune test never populated the line with
real data before removing it from season. Fixed in
`packages/db/migrations/0016_bootstrap-grower-pick-prune-guard.sql`: the delete now additionally
requires `pallets_picked = 0` and no matching `arrangement_records` row. A line that's genuinely
untouched still gets pruned exactly as before; a line with real data is left in place — visible
and editable, just no longer matching the current in-season list — rather than silently destroyed.
The existing prune tests in `packages/domain/src/grower/grower.test.ts` were rewritten to assert
the new (correct) behavior for all three cases: untouched (pruned), picked-but-unarranged
(preserved), and arranged (preserved, no cascade) — the old assertion that an arranged line's
`arrangement_records` row gets cascade-deleted on prune was itself the bug being fixed, not a
behavior to keep.

**A leaked-fixture cleanup, for the record.** An early version of this module's test file had a
cleanup-ordering bug — `runCleanup`'s LIFO teardown deleted a `product_varieties` row (and, in a
second test, a `companies` row) while a `daily_pick_products`/`arrangement_records` row still
referenced it, since the owning trading day's own cascade-delete hadn't run yet. Two test runs
failed mid-cleanup as a result, leaking two `Test Grower *` companies (with their products and
trading days) into the shared dev database — picked up by `initiate_business_day`'s
global grower-eligibility scan and inflating an unrelated `lifecycle.test.ts` assertion's count.
Fixed the test file (push each fixture's cleanup in dependency order — the day, and everything it
cascades to, before any customer/product fixture created alongside it) and manually removed the
two leaked companies/products/trading days/auth users from the dev database directly (with
explicit confirmation before each destructive step, since this was outside any test's own
teardown). See `packages/domain/vitest.config.ts`'s `fileParallelism: false` for the related,
more general fix — see `docs/ARCHITECTURE.md`'s grower picking module section for why that was
needed at all.

---

## 2026-07-11 — Lifecycle engine: `trading_days` as the anchor, replacing App Settings
## entirely; two real bugs found by testing the invariants, not just the happy path

**Context.** The four-phase daily trading lifecycle (Initiate Business Day → Open Shop → Close
Shop → Close Arrangement) needed a real state machine. The source models it as a mutable
singleton "App Settings" record with four overlapping status fields (`day_status`,
`shop_status`, `visible_buttons`, `arrangement_status`) and a set of "active_X" pointer fields
(`active_daily_shop`, `active_daily_arrangement`, etc.) that get manually cleared — a textbook R2
god-object, and the PRD's own Lifecycle Invariants doc documents the consequences directly: no
guard against a second `initiate_business_day` mid-cycle (silently orphans the previous day's
records), and an inconsistent Session-logging order between `close_shop` and `close_arrangement`
that makes a logged row mean two different things depending which workflow wrote it.

**What changed.**

- **`trading_days`** is the new anchor — one `phase` enum column (`initiated` → `shop_open` →
  `shop_closed` → `closed`) replaces all four source status fields. Which UI button to show next
  is a pure function of `phase`, not a fifth persisted field.
- **No App Settings singleton, no "active_X" pointer fields, anywhere.** A trading day's shop,
  picks, pick-product lines, orders, and arrangement are just rows with a `trading_day_id`
  foreign key back to it — reachable by a normal query the entire time the day is open
  (Lifecycle Invariant 3). Once `phase` reaches `'closed'`, a query for "the open day"
  (`phase <> 'closed'`) simply stops finding it; the invariant holds by construction, not by
  seven fields getting field-by-field cleared in a workflow action.
- **Lifecycle Invariant 1 ("at most one trading day open at a time") is a real constraint**: a
  partial unique index on `trading_days` — `create unique index ... on trading_days ((true))
  where phase <> 'closed'` — not an application-level check. Two concurrent
  `initiate_business_day` calls race on this index; exactly one wins. `daily_shops.trading_day_id
  unique` is the same guard one level down for Open Shop.
- **Every one of the four phase functions locates "the current open day" with `select ... for
  update`** before checking its phase, which does more than the two concurrency guards the prompt
  named explicitly (initiate/open): it also serializes concurrent `close_shop`/`close_arrangement`
  calls on the same day, so a double-click gets a clear rejection instead of running twice. This
  directly fixes the source's own documented `close_arrangement` double-click bug (a duplicate
  Session row, would-be duplicate WhatsApp dispatch) — R6: the invariant being kept is
  forward-only phase progression; the implementation being discarded is "no guard at all."
- **`submit_pick` and `update_pick_product_pallets`** (the grower-initiated actions) are
  `security definer`, unlike every other function in this schema so far, which are `security
  invoker`. The distinction is deliberate: forward-only status transitions and the
  arrangement-edit floor check ("pallets_picked can never drop below what's already arranged in
  `arrangement_records`") are stateful rules an RLS predicate can't express, so RLS on
  `daily_picks`/`daily_pick_products` grants growers no general write access at all — these two
  functions are the sole write path, performing their own ownership check
  (`current_company_id()` against the pick's `grower_company_id`) internally.
- **`lifecycle_sessions`** (the PRD's "Session" audit entity) is written as the *last* statement
  in both `close_shop` and `close_arrangement` — uniformly, unlike the source, where
  `close_arrangement` logged first (a row could exist for a failed attempt) and `close_shop`
  logged last (absence signals failure). Since each function is one Postgres transaction, a
  session row can only ever land if everything before it in the same function body also
  committed — R6: "log every transition" is correct, the inconsistent ordering is not.

**Two real bugs found by testing the invariants specifically, not just the happy path** — both
fixed in follow-up migrations rather than papered over in the tests:

1. **`update_pick_product_pallets`'s SELECT** originally tried `select dpp.*, dp.grower_company_id,
   dp.status into v_line, v_grower_company_id, v_pick_status` — plpgsql rejects mixing a composite
   target (`dpp.*`) with scalar targets in one INTO list ("record variable cannot be part of
   multiple-item INTO list"), caught immediately at migration-apply time, not at test time. Fixed
   by fetching the two scalars from a plain join query and letting the final `UPDATE ... RETURNING`
   populate the row.
2. **`close_arrangement`'s Invariant-4 "surface a pick still open at phase 4" check** used
   `dp.status <> 'closed'`, which matches both `'draft'` and `'submitted'` — since every pick is
   one or the other right up until the mass-close a few statements later, this flagged *every*
   grower's pick as a no-show, not just genuine ones. `'submitted'` at phase 4 is the normal,
   expected case (Invariant 4: "Phase 3: Picks are in Submitted"); only `'draft'` is worth
   surfacing. Caught by a test asserting the *exact* contents of the no-show list, not just that
   the day closed — fixed in `0013_close-arrangement-draft-check-fix.sql`.

**See also.** `packages/db/migrations/0009_lifecycle-schema.sql` (DDL + the partial unique
index), `0010_lifecycle-rls.sql` (policies, including the deliberate absence of a grower write
policy on `daily_picks`/`daily_pick_products`), `0011_lifecycle-functions.sql` (the six
functions), `0012_lifecycle-cascade-deletes.sql` (a trading day's children cascade-delete with
it — needed for clean test teardown, and the correct relational shape either way, since
production code never deletes a `trading_days` row regardless), `0013` (the close_arrangement
fix above), and `packages/domain/src/lifecycle-engine/lifecycle.test.ts` (all five invariants
plus both concurrency guards, all in one file — deliberately, since Invariant 1 is a *global*
constraint, not scoped to a test's own fixtures the way every other constraint in this project's
tests has been; running these sequentially in one file is what makes that safe without a
dedicated test database per suite).

---

## 2026-07-10 — Reference-data module: full Company aggregate, product catalog, and `save_*` RPC functions

**Context.** The five Backoffice reference-data screens (Growers, Customers, Products, Users,
Transporters) needed the placeholder `companies`/`product_varieties` tables from the auth-module
prompts fleshed out into the PRD's real aggregates, plus the two join tables the screens
introduce: a grower's in-season product selection and a new per-customer pallet cap. R4 and R7
apply "the Supabase way" here — every multi-field save is a `plpgsql` function invoked via
`supabase.rpc()`, not a sequence of client-side `.update()` calls, so a failure partway through
rolls back everything the call did (a single function invocation is one Postgres transaction).

**What changed.**

- `companies` gains `type` (`backoffice`/`grower`/`customer`/`transporter` — unlike `user_role`,
  this one DOES include `transporter`, since a Transporter company is real reference data even
  though no user ever authenticates as one), `status` (`active`/`inactive`, per the PRD's
  2-state Company Status machine), `default_pickup_time`, `can_see_product_prices`, and
  `whatsapp_group_id`.
- New tables: `product_families` (the catalog's parent grouping) and two join tables —
  `grower_products` (a grower's in-season selection, the PRD's `products_in_season_list`
  modeled as a real many-to-many relationship, same call as `profile_blocked_products`) and
  `product_customer_caps` (the new per-customer pallet cap this prompt introduces — not in the
  source PRD, a genuine per-pair setting between a product and a customer).
- `product_varieties` gains the full catalog field set (sizes, pack type, pricing, overbooking
  buffer, seasonal-availability flag) plus `version integer not null default 1` — the column
  optimistic concurrency is built on. `price_type` and `product_families.category` are left as
  free `text`, not closed enums: the PRD only gives examples/an incomplete list for both
  ("about a dozen values... etc."), and guessing the rest would be inventing a requirement, not
  preserving one.
- **RLS tightened on `companies`**: the blanket "any authenticated user reads every row" policy
  from the initial RLS pass is gone — now that the table holds real tenant data, that was
  exactly the cross-company leak `company.md` warns about. Replaced with backoffice-reads-all
  (already covered by the existing write policy) plus a new self-row read
  (`current_company_id()`, a `current_role()`-style `SECURITY DEFINER` helper) — e.g. a Grower
  can read their own company record, nothing else's.
- **`profiles` gains a backoffice UPDATE policy** — the Users screen needs to edit someone
  else's role/display name/company, which the self-only update policy from the first RLS pass
  didn't permit.
- **Five `save_*` `plpgsql` functions** (`save_grower`, `save_customer`, `save_transporter`,
  `save_product`, `save_user`) — `security invoker` (the default, stated explicitly): each runs
  with the calling user's own privileges, so RLS still governs every write inside it; a
  function body isn't a way around RLS. Each also does an explicit
  `current_role() <> 'backoffice'` check for a clear, catchable error instead of relying only on
  a silently-filtered RLS write (same source of truth as the policies, just surfaced earlier and
  more legibly). `save_grower` and `save_user` each replace a whole join-table selection
  (in-season products / blacklist) in the same transaction as the parent row write.
- **Optimistic concurrency on `save_product`**: an `expected_version` parameter checked and
  incremented in the same `UPDATE` statement that writes the row — a concurrent second writer
  simply matches zero rows, which the function turns into a raised, catchable conflict rather
  than a silent overwrite or a UI-level "someone's editing this" lock (R7).
- **A real bug found and fixed while testing the conflict path end-to-end** (not just via a
  trusted direct connection, but through the actual anon-key + signed-in-JWT path apps/web
  uses): the conflict branch originally raised with SQLSTATE `40001`
  (`serialization_failure`) — a reasonable-looking choice ("a concurrent write conflicted"), but
  `40001` is the exact code Postgres itself uses for `SERIALIZABLE` transaction conflicts, and
  the connection-pooling layer between PostgREST and Postgres treats it as transient and worth
  retrying. Every retry hit the same version mismatch and got `40001` again, so a legitimate,
  immediate conflict took tens of seconds to finally surface — not wrong, just badly disguised
  as a hang (this is exactly what a naive fixed-timeout retry in a test suite would paper over
  instead of catching). Fixed in `0008_product-conflict-errcode-fix.sql`: the conflict now
  raises `P0003` (Postgres's own PL/pgSQL "user raised exception" class,
  `P0001`-`P0009` — the same class already used for `NOT_FOUND`'s `P0002`), which nothing in the
  stack retries.
- `deleteUser` (packages/domain/src/auth/delete-user.ts, `apps/api`'s `auth.deleteUser`) rounds
  out full CRUD on the Users screen — goes through the Supabase Admin API rather than a plain
  RLS-scoped `DELETE FROM profiles`, which would leave a `profiles`-less `auth.users` identity
  behind instead of actually removing the account.

**See also.** `packages/db/migrations/0005_reference-data-schema.sql` (DDL),
`0006_reference-data-rls.sql` (policies), `0007_reference-data-functions.sql` (the five
functions), `0008_product-conflict-errcode-fix.sql` (the errcode fix), and
`packages/domain/src/reference-data/rpc.test.ts` (the concurrent-edit and partial-failure tests
that caught the bug above).

---

## 2026-07-10 (later) — Row Level Security, `must_change_password`, and retiring the custom

## auth tables

**Context.** With the identity split in place (see the entry below), this pass finished
adopting Supabase Auth: the custom session/password-reset-token/temporary-credential system
built in the prior auth-module prompt is fully replaced by Supabase's own session handling,
recovery-link flow, and Admin API — so the tables that backed it are gone, and RLS becomes the
primary authorization layer per R7.

**What changed.**

- `public.auth_sessions`, `public.password_reset_tokens`, and `public.temporary_credentials`
  are **dropped**. Nothing in the application queries them anymore: sign-in, session refresh,
  and password reset are `supabase-js` calls against Supabase's own `auth.*` tables (which we
  don't own or migrate), and admin-mediated resets/bulk-provisioning go through the Supabase
  Admin API (`auth.admin.createUser`, `auth.admin.generateLink`), not a hand-rolled
  credential table.
- `profiles.must_change_password` (boolean, default `false`) is added. Both bulk-imported
  users and admin-mediated resets set it `true`; the client clears it itself via the
  `profiles_update_own` RLS policy the moment `auth.updateUser({ password })` succeeds. This
  column didn't exist when `profiles` was first created (that prompt only specified `role`,
  `display_name`, and the company relationship) — the forced-first-login-change requirement
  came in this pass.
- `current_role()`: a `SECURITY DEFINER` Postgres function (`public.current_role()`) that
  resolves the calling user's `profiles.role` via `auth.uid()`. `SECURITY DEFINER` is load
  bearing, not incidental — without it, a policy that calls this function from inside another
  table's RLS check would recurse into `profiles`' own RLS evaluation. `search_path` is
  pinned to `public` for the standard reason every `SECURITY DEFINER` function should pin it.
- **Row Level Security is enabled (and forced) on every table**: `profiles`, `companies`,
  `product_varieties`, `profile_blocked_products`. The baseline pattern, meant to be extended
  per-table by later modules rather than re-invented:
  - `profiles`: a user reads/updates their own row (`user_id = auth.uid()`); only backoffice
    (`current_role() = 'backoffice'`) reads other users' rows. No general backoffice _write_
    to other rows yet — that's still unspecified, and admin operations that need it go
    through the service-role client instead (which bypasses RLS entirely), not a policy.
  - `companies` / `product_varieties`: any authenticated user reads the whole table (both are
    small reference catalogs with nothing sensitive on them yet); only backoffice writes.
  - `profile_blocked_products`: a user reads their own blocklist; backoffice has full access.
- A **firm trust-boundary note, worth stating explicitly**: RLS only constrains connections
  using Supabase's `anon`/`authenticated` Postgres roles — i.e. requests through
  PostgREST/`supabase-js` carrying a user's own JWT. `packages/db`'s Drizzle client connects
  directly as the Postgres superuser (or an equivalent elevated role on hosted Supabase) and
  **always bypasses RLS**, by Postgres design, `FORCE ROW LEVEL SECURITY` notwithstanding
  (`FORCE` only affects non-superuser table owners). That's intentional, not a gap: `apps/api`
  is a separate trust boundary authorized by its own explicit `requireRole` check (verifying
  the caller's JWT, then looking up their role via the same trusted connection), not by these
  policies. Anything running through `packages/db` directly is already inside the trusted
  perimeter these policies don't apply to.
- `user_role` (the enum) already excluded `transporter` as of the identity-split entry below;
  no change here, restated only because it's directly relevant to why `current_role()`'s
  return type has exactly three values.

**Local development note.** The `local-auth-stub.sql` mentioned in the entry below is gone —
this pass moved local development onto the real Supabase CLI stack (`supabase start`), which
provides a genuine `auth.users` table and Auth server, so the stub (a bare `id`-only
placeholder sufficient only for foreign-key resolution, not for actually signing in) is no
longer needed. See the root `supabase/` directory and `.env.example`.

---

## 2026-07-10 — Identity split: `auth.users` (Supabase) vs `public.profiles` (ours)

**Context.** We're adopting Supabase fully: Auth, Row Level Security, and the client SDK. That
means user identity — email, password, session/JWT lifecycle, password recovery — is no longer
something this codebase owns. Supabase Auth (GoTrue) owns it, in its own `auth.users` table.

**What changed.**

- `public.users` (the standalone identity table from the previous schema — email, password
  hash, `must_change_password`, name fields) is **dropped**. Its reason for existing was to be
  the credentials/identity record; that's now `auth.users`'s job, and we don't migrate or write
  to that table directly.
- `public.profiles` is added: one row per login-capable user, holding only the fields that are
  genuinely ours — `role`, `display_name`, `company_id` — keyed by `user_id`, a foreign key to
  `auth.users(id)` **with `ON DELETE CASCADE`**. Deleting the Supabase Auth identity deletes the
  profile; there's no path to an orphaned profile.
- `auth.users` is represented in Drizzle only as a **shadow table**
  (`packages/db/src/schema/auth-users.ts`) declaring just its `id` column, via
  `pgSchema("auth").table("users", { id: uuid("id").primaryKey() })`. This exists solely so
  `profiles.user_id` can carry a real, typed foreign key — we never generate DDL for it.
  `drizzle.config.ts` points its `schema` entry at
  `packages/db/src/schema/migrations-schema.ts`, a barrel that deliberately excludes
  `auth-users.ts`, so `drizzle-kit generate` never tries to create or alter Supabase's own
  schema. (The runtime barrel, `schema/index.ts`, still exports it — application code can
  reference `authUsers` for typed joins if ever needed.)
- Every foreign key elsewhere in the schema that pointed at `users.id` now points at
  `profiles.user_id` instead: `auth_sessions.user_id`, `password_reset_tokens.user_id`,
  `temporary_credentials.user_id`, and `temporary_credentials.issued_by_user_id`. All four are
  now `ON DELETE CASCADE` except `issued_by_user_id` (an admin shouldn't be able to vanish their
  own audit trail by being deleted — left as `NO ACTION`, matching the original).
- The `user_role` enum drops its fourth value, `transporter`. A transporter never signs in, so
  it never gets a Supabase Auth account, and therefore can never have a `profiles` row — the
  role column on the row that's guaranteed to exist for every authenticated user no longer needs
  to represent a role that guarantees the opposite.

**Two judgment calls worth flagging explicitly:**

1. **`company_id` stayed on `profiles`, even though it wasn't in the prompt's named field list.**
   The prior `users` table had it as a required FK, and the whole PRD's tenant-scoping model
   ("every user belongs to exactly one company") depends on it. Dropping it silently would have
   been a real regression, not a simplification, so it's carried over as one of "the fields that
   are actually ours."
2. **The product blacklist is a join table, not an array column.** `known-gaps.md` flags the
   Bubble source for implementing this as a list-of-references field on the User row. Rather
   than reproduce that shape (or invent a different one unprompted), it's modeled as a genuine
   many-to-many relationship: `public.profile_blocked_products (user_id, product_variety_id)`,
   both columns FKed with cascade delete. Since the product catalog doesn't exist yet (that's
   the reference-data module), there's a minimal placeholder table,
   `public.product_varieties (id, name, timestamps)` — the same pattern already used for
   `companies` in the initial scaffolding: just enough shape to be a real FK target, expected to
   be absorbed into the reference-data module's real catalog later. This still leaves open
   _which_ entity should own the gate (profile vs. customer/company, per the PRD's own
   documented disagreement with the source) — that's a product decision for the reference-data
   module, not a schema-layer one.

**No other table's primary-key strategy is affected.** `companies.id` is unchanged
(`uuid`/`gen_random_uuid()`). The only PK shape that changes anywhere is the new `profiles`
table itself, which is intentionally keyed by `user_id` (not a separate generated `id`) — it's a
1:1 extension of an `auth.users` row, not an independent entity, so its primary key **is** the
foreign key.

**What this deliberately does _not_ touch (yet).** `auth_sessions`, `password_reset_tokens`, and
`temporary_credentials` — the tables backing our own hand-rolled session/reset/temp-credential
system from the previous auth-module prompt — still exist, structurally unchanged apart from
their FK target. Supabase Auth has its own session (JWT) handling and its own password-recovery
flow, which makes this custom machinery redundant in principle. Removing it means rewriting
`packages/domain/src/auth/*`, the API's auth router, and the web app's login/reset/
change-password/bulk-import UI to call `@supabase/supabase-js` instead — a substantial piece of
work, and explicitly out of scope for "just the schema." Until that migration happens, these
three tables (and all the code built around the old `users` table) will not compile/run against
this schema — see the note below.

**Row Level Security is out of scope here** — that's the next prompt. No RLS policies are
defined on `profiles` or anything else in this change.

**Local development note (superseded — see the entry above).** At the time of this prompt,
dev/test ran against a plain Postgres container with a bare-bones stand-in `auth.users` table
(`packages/db/scripts/local-auth-stub.sql`), since `auth.users` doesn't exist outside a real
Supabase project and this prompt was schema-only — no Auth server was needed yet. The very
next prompt required actually exercising Supabase Auth end to end, at which point local
development moved onto the real Supabase CLI stack and this stub was deleted.

---

## 2026-07-09 — Initial schema (companies, users, auth_sessions, password_reset_tokens, temporary_credentials)

See the auth-module prompt's implementation for context. Superseded by the entry above as of
2026-07-10 — `users` no longer exists; see `packages/db/src/schema/`.
