# Architecture

This document is the standing reference for how "Ori and the Bananas" is being rebuilt as a
from-scratch, custom-code replacement for the existing Bubble.io application. Every future
prompt in this project is held to the contract below.

## Standing contract

R1 — Behavior is the spec, implementation is not. Never carry over a Bubble
mechanism because "that's what it did" — design the clean way to reach the
same outcome, even where the old way looks harmless.
R2 — No god-object singleton. Model state as real rows you can query, never as a
single config record with list-of-reference fields that get manually cleared.
R3 — No shadow rows for idempotency. Use upserts on unique keys or pure recompute
functions instead of duplicate "temp" records that downstream code must filter.
R4 — Multi-step writes are one transaction (or an explicit saga with compensations
for steps touching external systems). Partial failure must be unobservable.
R5 — One named function, not a trigger chain, for any derived/propagated state.
R6 — Preserve correct business rules, discard their implementation — on every
module, including ones whose existing code already looks fine.
R7 — Concurrency is the database's job: constraints, locks, version tokens — not
an app-level "already in progress" flag.
R8 — UI is routed and scoped per role/screen. No single page holding every tab.

The PRD at [`reference/prd/`](../reference/prd/) — a reverse-engineered export of the live
Bubble app (entities, state machines, lifecycle phases, screens, and `known-gaps.md`) — is
read as a description of required **behavior only**. Bubble field names, table shapes, and
workflow structure are not requirements; the business outcomes they produce are.

## Stack

TypeScript throughout, in a pnpm + Turborepo monorepo:

```
apps/
  web/          React SPA on Vite — role-scoped routing via React Router
  api/          Fastify host exposing a tRPC router
packages/
  domain/       Framework-agnostic business logic, one folder per module boundary
  db/           Postgres schema + Drizzle client, migrations
  shared/       Cross-cutting Zod schemas, types, env validation
  config/       Shared tsconfig / eslint / prettier presets
```

**Postgres + Drizzle.** Drizzle stays close to raw SQL rather than hiding it behind an
abstraction, which matters directly for this project: R4 (explicit transactions) and R7
(row locks, `SELECT ... FOR UPDATE`, unique constraints) are exactly the tools that fix the
PRD's known concurrency and partial-write bugs — the non-idempotent arrangement close, the
un-guarded mid-cycle day re-initiation, the transaction-less backoffice saves. A query
builder that makes transactions and locking awkward would fight the contract instead of
supporting it.

**Fastify + tRPC.** This is an internal operational tool with exactly one frontend, not a
public API — tRPC removes the need to hand-maintain a REST/OpenAPI contract in parallel with
the code, while still giving the frontend full type inference on every procedure.

**React + Vite (single-page app).** Each role's screen is its own route, not a tab inside one
page (R8) — the route tree in `apps/web/src/app-routes.tsx` nests every screen under its role's
layout, and each one is a lazily imported chunk so a customer never downloads the backoffice.

Migrated from Next.js (App Router) on 2026-09-08. Next was carrying almost none of its weight
here: no screen fetched data on the server, there were no server actions and no static
generation, and 37 of 66 source files were already `"use client"`. Its server components did
exactly two things — call `requireRole()` and redirect — so the framework's cost was landing
mostly on the auth path (see "Route gating" below), not buying rendering the app used.

**pg-boss for background work.** Postgres-backed job queue — no separate broker to run. Its
job is enqueuing inside the same transaction as the write that triggers it, which is what
makes "arrangement close finalizes state and enqueues notifications" atomic instead of two
separate steps that can diverge under failure (the double-send bug in the known gaps is
exactly this failure mode).

**Supabase (Auth + Row Level Security + client SDK).** Superseded a first custom session/
argon2/password-reset-token auth module entirely — identity now lives in Supabase's own
`auth.users`, with `public.profiles` as the "ours" extension. Sign-in, session refresh,
self-service password reset, and voluntary/forced password change are plain `supabase-js`
calls made directly from `apps/web` — no API round-trip, since Supabase _is_ the identity
provider. `apps/api` only still exists, for auth purposes, to hold the two operations that
need the service-role key (bulk user import, admin-mediated reset via `auth.admin.*`) in a
trusted server context, gated by its own `requireRole` check (verifying the caller's Supabase
JWT and looking up their role) rather than by RLS, which that elevated client bypasses by
design. RLS — see `packages/db/migrations/0003_row-level-security.sql` and
`docs/SCHEMA_DECISIONS.md` — is the primary authorization layer for direct data access
(R7): every table has RLS enabled, with a `current_role()` helper and a self-row/
backoffice-row pattern on `profiles` that later modules extend per-table.

**Route gating, and where the authorization boundary actually is.** Under Next.js each role
layout called a server-side `requireRole()`, so an unauthorized user never received the page.
In the SPA that check is `RequireAuth` (`apps/web/src/lib/require-role.tsx`), declared once per
role area on the parent route and evaluated in the browser.

This is a deliberate, documented trade-off, and it is worth being precise about what changed
and what did not. What changed: route *visibility*. An unauthorized user now downloads the JS
bundle and gets bounced client-side instead of being refused the page — defence in depth that
the server used to add is gone. What did not change: the authorization boundary. RLS was always
the thing enforcing who can read and write which rows, keyed off `auth.uid()` from the signed
JWT rather than off anything the client asserts, so a user who forces past the client guard
reaches a layout whose every query returns an empty set. The two service-role operations, which
bypass RLS by design, were never covered by the layout guard either — they are gated
server-side by `apps/api`'s own `requireRole`, and that is untouched.

Session refresh moved with it. `@supabase/ssr`'s cookie-based client, the `middleware.ts` that
refreshed the token on every request, and the verified-identity request headers it forwarded to
Server Components all existed because a Server Component can read cookies but not write them.
With no server render, `supabase-js` keeps the session in localStorage and refreshes it on a
timer in the browser, and that entire mechanism — along with the per-navigation `requireRole()`
round trips it was built to avoid — is deleted rather than replaced.
**Vitest + Playwright.** Vitest for unit/integration tests run against a real Postgres
instance, not mocks. Playwright for end-to-end coverage of the three role-based flows
(grower picking, customer ordering, distributor running the day).

## Module boundaries

`packages/domain` holds one folder per boundary. Each exposes named, framework-agnostic
functions (R5) that `apps/api`'s tRPC procedures call — no business logic lives in route
handlers, and no derived state is produced by a chain of implicit triggers.

- **auth** — the two service-role-backed admin operations (bulk user import, admin-mediated
  password reset via Supabase's Admin API) that can't run through RLS-bound client access.
  Sign-in, session, and self-service password change/reset live entirely in `apps/web` as
  direct `supabase-js` calls; the role → route resolver (`resolveHomeRoute`, replacing the
  PRD's per-page duplicated routing branches) lives in `packages/shared` so both `apps/web`
  and `apps/api` can use it without either depending on `packages/domain`.
- **reference-data** — companies, users, and the product family/variety catalog: the
  slow-changing data every trading day is built against.
- **lifecycle-engine** — the trading day as a first-class, queryable aggregate with one real
  phase enum, and the transactional functions that move it between phases. Replaces the
  Bubble app's singleton config record and its hand-maintained "active X" pointer fields
  (R2) with a genuine query for "what's today."
- **grower** — daily pick entry/revision and the leftover computation that runs once, as a
  named function, when a pick closes (not the three near-duplicate cascading triggers it
  replaces).
- **customer** — daily order entry/revision and shop-side out-of-stock visibility.
- **arrangement** — matching picked supply to ordered demand, the cross-grower/
  cross-customer out-of-stock aggregation, and the terminal close-arrangement transaction.
  This is the real source of fulfillment truth — order status never reflects it.
- **notifications** — outbound WhatsApp dispatch and templates, enqueued transactionally
  alongside the state change that triggers them, with per-recipient isolation and real
  retry/observability in place of the current single-hardcoded-email dead-letter.

## The daily trading cycle

The system runs one cycle per trading day, and — deliberately — only one day is ever open at
a time: there is one shop, one set of active picks and orders, one arrangement being worked.
That single-active-day constraint is a genuine business rule (this is a small operation with
one trading relationship running at a time, not a multi-tenant marketplace); only its current
implementation as a mutable pointer record is not something to keep.

The cycle moves through four phases, strictly forward, with no rewind:

1. **The day begins.** The distributor opens trading for the day. Every grower who has
   product in season is set up with a blank pick sheet for today, ready to fill in — nothing
   is customer-visible yet. Growers can start recording what they've picked; customers still
   see nothing new.

2. **The shop opens.** The distributor publishes today's catalog. Every active customer gets
   an order started against today's prices and stock. From this point, customers can place
   and revise orders while growers keep updating and refining their picks in parallel.

3. **The shop closes.** Ordering stops — customers can no longer submit or change an order.
   Growers, however, are still allowed to revise their picks (correcting counts, recording
   leftovers) because the distributor now needs accurate final supply numbers before doing
   the actual matching of who gets what.

4. **The arrangement closes — the terminal step.** The distributor finalizes the match
   between what was picked and what was ordered. This is the moment that actually matters
   commercially: final prices are set, every grower's pick is locked for the day, leftover
   pallets are recorded, and growers and customers are notified of the outcome. Immediately
   after, the system resets to a clean slate so the next day can begin.

Only the distributor advances the cycle; growers and customers act _within_ whichever phase
is currently open, on their own company's data. A driver/transporter is not a cycle
participant at all — they receive an outbound delivery notification and never touch the
system directly.

## Status

Scaffolding is complete — linting, formatting, tests, CI, and environment config are wired
up end-to-end (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass).

**A real `pnpm build` regression and its root cause, for the record** (predates the move to
Vite; kept because it is why `NODE_ENV` is absent from `.env`). `.env` briefly set
`NODE_ENV=development` (present from the initial scaffolding). Because every command in this
project sources `.env` into the shell before running (to avoid typing secrets directly — see
the credential-handling note below), that value got exported into every `next build` invocation
too. Next.js's own build step forces production mode internally regardless, but an explicit,
externally-set `NODE_ENV` creates exactly the inconsistency its own `next build` warning names
("You are using a non-standard NODE_ENV value") — and in this case it deterministically broke
prerendering of the built-in `/404`/`_error` page with a confusing, seemingly-unrelated
`<Html> should not be imported outside of pages/_document` crash (occasionally manifesting
instead as a `Cannot read properties of null (reading 'useState')` crash on an arbitrary static
route — same root cause, different symptom depending on worker-pool scheduling). Confirmed by a
clean round-trip: build fails with `NODE_ENV=development` exported, passes 3/3 with it unset,
independent of node_modules state, workspace vs. direct `apps/web` invocation, or Next/React
version (single resolved version of each across the whole workspace — `pnpm -r why next/react
/react-dom` shows no mismatch). Fixed by removing `NODE_ENV` from `.env`/`.env.example`
entirely — nothing in the codebase actually reads `process.env.NODE_ENV` (grep confirms the one
place it was validated, `apps/api/src/env.ts`, never consumed the parsed value), and every tool
here (`vite` and `vite build`, previously `next dev`/`build`/`start`; `vitest`) sets it
correctly on its own per command. No Next config workaround was needed or kept.

**A known, external e2e characteristic — not a code bug, and not fixable from the client side.**
Running the reference-data e2e specs against a real production build (now `vite build` +
`vite preview`) surfaced a row created on one page (`/backoffice/users/import`) taking a few
seconds to show up after navigating straight to a different page (`/backoffice/users`) that
lists it. Root-caused as far as possible from the client: Postgres itself has no replication
lag (single primary, no read replicas — confirmed a direct, immediate `.eq()` read after the
same write is always instant); it isn't the browser's HTTP cache (`cache: "no-store"` on every
request changed nothing); and it isn't an ordinary cache respecting request headers either (an
explicit `Cache-Control: no-store` request header, sent correctly, also changed nothing). That
combination points at short-lived caching on Supabase's own hosted REST gateway for a repeated
identical GET URL — the unfiltered, identically-parameterized list query — which nothing sent
from the client can force it to bypass. The four other reference-data screens never hit this
because their create-then-list is same-page (`queryClient.invalidateQueries()` right after the
mutation resolves), not a fresh cross-page navigation. `reference-data-users.spec.ts`
accommodates this with one reload-and-retry rather than a longer fixed timeout (silently
waiting longer wouldn't be honest about what's actually happening) or a client-side header hack
(tried and confirmed ineffective). `playwright.config.ts`'s default assertion timeout is also
10s rather than the 5s default — the first real request of a run round-trips to a remote hosted
Supabase project, and under Next it also paid a server cold start (module instantiation, DB
connection pool warmup). That genuinely needs more headroom than local dev timing implied.

The **auth module** is implemented on Supabase Auth: sign-in with role-based redirect, forced
password change on first login (`profiles.must_change_password`), self-service password reset
via Supabase's built-in single-use recovery-link flow, admin-mediated reset and bulk user
provisioning via the Supabase Admin API (service-role key confined to `apps/api`, never sent
to the client), and Row Level Security as the primary authorization layer (a `current_role()`
Postgres helper plus baseline self/backoffice policies on every table, established in
`packages/db/migrations/0003_row-level-security.sql` for later modules to extend). See
`packages/domain/src/auth/` for the two admin operations and their tests (including RLS
tests exercised through the real anon-key + signed-in-JWT path, never the service-role
client), `apps/api/src/routers/auth.ts` for the API surface, and `apps/web/src/routes/{login,change-password,reset-password}.tsx`
plus the `(backoffice)/(grower)/(customer)` layouts for the UI.

The **application shell** (R8) is in place: one route group per role (`(backoffice)`,
`(grower)`, `(customer)`), each screen/tab its own route rather than a tab inside one page, a
persistent per-role nav shell (`BackofficeNav`, the shared `RoleShell`), a small component
library (`Skeleton` with GPU-composited `transform` animation, sticky-header `Table`, native
`<dialog>`-based `Dialog`, `Toast`), and RTL as a first-class layout concern (`dir="rtl"
lang="he"` on the root `<html>`). Session state is `onAuthStateChange`-driven
(`apps/web/src/lib/auth-context.tsx`); the shell's role check decides what to render, RLS still
decides what data can move — the two are deliberately not merged into one check. Route stubs
exist for every PRD-named screen, ready for feature work.

The **reference-data module** is implemented: the five Backoffice management screens (Growers,
Customers, Products, Users, Transporters) have full CRUD, wired into the shell. Every multi-field
save is a `plpgsql` function invoked via `supabase.rpc()` (R4 — one function call is one
transaction, so a failure partway through is unobservable, not partial) rather than a sequence of
client-side `.update()` calls; `save_product` additionally implements real optimistic concurrency
via a `version` column checked and incremented in the same statement that writes the row (R7),
raising a catchable conflict instead of silently overwriting a concurrent edit. See
`packages/db/src/schema/`, `packages/db/migrations/0005`-`0008`, `packages/domain/src/reference-data/`
(input schemas + test fixtures + the concurrent-edit/partial-failure test suite), and
`apps/web/src/routes/backoffice/{growers,customers,products,transporters,users}.tsx`.

The **lifecycle engine** is implemented: the four-phase daily trading lifecycle (Initiate
Business Day → Open Shop → Close Shop → Close Arrangement) as an explicit state machine anchored
on a single `trading_days.phase` column, replacing the source's App Settings singleton and its
"active_X" pointer fields entirely (R2) — a trading day's shop, picks, orders, and arrangement
are just rows with a `trading_day_id` foreign key, reachable by a normal query the whole time the
day is open. At most one trading day is ever open at a time, enforced by a partial unique index
(R7), not an application check; every phase function locates the current open day with `select
... for update`, which also serializes concurrent close_shop/close_arrangement calls on the same
day — a direct fix for the source's documented double-click bug, not a reproduction of it (R6).
The two grower-initiated actions (`submit_pick`, the Draft→Submitted transition; and
`update_pick_product_pallets`, which enforces the arrangement-edit rule that a variety's picked
quantity can never drop below what's already been arranged to customers) are `security definer`
functions — RLS grants growers no general write access to `daily_picks`/`daily_pick_products` at
all, so these two functions, with their own internal ownership checks, are the sole write path
for rules an RLS predicate can't express. See `packages/db/migrations/0009`-`0013`,
`packages/domain/src/lifecycle-engine/` (input schemas, error-code constants, test fixtures, and
a single consolidated test file covering all five documented lifecycle invariants plus both
concurrency guards — deliberately one file, since "at most one open day" is a global constraint
none of this project's other tests have had to share across test cases before).

The **grower picking module** is implemented: grower-facing daily picking input
(estimates/actual quantity as one `pallets_picked` field per line, plus a comment) and the
distributor's Grower Inventory Status oversight screen
(every active grower's pick status, editing a submission on their behalf, adding in-season
products mid-day, sending a reminder). Two replacements were the explicit point of this
module:

- **`bootstrap_grower_pick`** (R3) replaces the source's real+temp record pair (one
  placeholder row per variety per rerun, filtered out of every downstream query) with a true
  idempotent upsert-and-prune: `insert ... on conflict (daily_pick_id, product_variety_id) do
  nothing` preserves whatever a grower already entered, and a `delete ... where not exists`
  prunes lines for products that fell out of season — which cascades away any
  `arrangement_records` referencing that line for free (0012's `on delete cascade`), matching
  what the source did as a separate rerun-only cleanup step. There is no `is_temp_record`
  column, or any concept like it, anywhere in this schema. `initiate_business_day` (Phase 1)
  now calls this once per eligible grower instead of holding its own inline bootstrap
  `insert`s, and the same function is what "add products" calls after `save_grower` so a
  mid-day in-season change gets a pick line immediately, not on the next full-day rerun.
- **`close_out_pick_leftovers`** (R6) replaces the source's three separately-triggered,
  near-identically-named workflows (`update left overs` → `update_leftovers` →
  `update leftover data`) — its own PRD calls this chain "a maintenance hazard" — with one
  named function, called directly from `close_arrangement` (Phase 4) in the same transaction,
  after picks are mass-closed so `pallets_picked` is final. Since a `plpgsql` function called
  from inside another runs in the same transaction by default, no queue or trigger relay was
  needed to get that guarantee. It also collapses the source's two near-identical leftover
  fields (`Leftovers`, `Leftover Pallets After Day End`) into one `leftover_pallets` column.

`bootstrap_grower_pick` is not Phase-1-only — the distributor's "add products" action on the
Grower Inventory Status screen calls it again directly, any time mid-day, after `save_grower`
changes a grower's in-season list. An initial version's prune step didn't account for that: it
deleted an out-of-season line unconditionally, regardless of whether it already carried real
picked quantity or an `arrangement_records` row — a real data-loss bug, caught before merge and
fixed in `packages/db/migrations/0016_bootstrap-grower-pick-prune-guard.sql`. The prune step now
only removes a line that is both `pallets_picked = 0` and has no `arrangement_records` referencing
it; a line with real data survives a mid-day re-run even if its product just left season, rather
than being silently cascade-deleted. See `packages/domain/src/grower/grower.test.ts`'s prune-guard
test, which drives exactly this scenario (an untouched line, a picked-but-unarranged line, and an
arranged line, all removed from season in the same re-run) and asserts each is handled correctly.

The Cancel button on both screens is fixed by construction, not as a special case: pick-line
edits (`pallets_picked`, `comment`) live in local component draft state
(`PickLinesEditor`, shared by both screens — the same `update_pick_product_pallets`/
`update_pick_product_details` functions already accept "the owning grower, or backoffice," so
the distributor editing on a grower's behalf is not a special case either) until Save is
pressed; Cancel calls no RPC at all, it just re-derives the draft from the last-loaded server
rows, mirroring the reference-data screens' existing `editing`/`toFormState`/`handleDiscard`
pattern. See `packages/db/migrations/0014`-`0015`, `packages/domain/src/grower/` (input
schemas, test fixtures, and direct tests of `bootstrap_grower_pick`'s idempotency/pruning and
`close_out_pick_leftovers`'s computation — independent of the full lifecycle, since neither
function reads `trading_days.phase`), and `apps/web/src/routes/grower/picks.tsx` +
`apps/web/src/routes/backoffice/distributor-grower.tsx`.

Both screens are also covered end to end (`apps/web/e2e/grower-picks.spec.ts`,
`apps/web/e2e/distributor-grower.spec.ts`): a real edit-and-reload on each screen (driven through
the actual `initiate_business_day` RPC, not a hand-inserted row, so the real
`bootstrap_grower_pick` path is exercised too), plus a dedicated Cancel test that types into a
field, hits Cancel, and reloads the page — a fresh mount with no client-side draft state left to
fall back on — to confirm the original value, proving Cancel never reached the server rather than
just asserting the button resets the visible input.

**A test-isolation note, for the record.** `initiate_business_day`'s grower-eligibility scan
(`every active grower with in-season products`) is intentionally global, like the
single-open-trading-day constraint — but unlike that constraint, this one wasn't guarded by
anything before this module, because no earlier test file created grower fixtures that could
collide with it. Adding `grower/grower.test.ts` (which does) exposed that gap: Vitest's
default file-level parallelism let a grower fixture from one test file leak into another
file's `initiate_business_day` count. Fixed by setting `fileParallelism: false` in
`packages/domain/vitest.config.ts` — test files in this package now always run sequentially,
the same reasoning `lifecycle.test.ts`'s own top comment already gives for keeping tests
sharing a global constraint in one file, extended to the file level.

The **customer ordering module** is implemented: catalog browsing with live stock and price,
placing/updating an order through the trading day, a submission confirmation step, order
history, and the v1.3 submission audit log. Two things were the explicit point of this module:

- **`get_orderable_catalog_for_customer`** (R1/R5/R6) is the single, shared, database-level
  answer to "which varieties can this customer order right now," replacing two compounding
  source bugs at once. The source's OOS-list *maintenance trigger* only fired
  `OldDataItem._id is_not_empty` on an order line — true on UPDATE, false on CREATE — so the
  first customer to deplete a variety never flipped the shop's stored out-of-stock list; the
  fix here has no stored list to go stale in the first place, since orderability is computed
  live, on every read (R5 — no trigger, no CREATE/UPDATE distinction to get wrong). The
  source's *family-level* filter separately re-excluded a whole product family the moment any
  one of its varieties appeared in the OOS list, even when a sibling variety was still in
  stock; the fix here has exactly one filter, applied at variety level
  (`shop_variety_orderability`, a narrowly-scoped `security definer` helper that does the
  actual cross-tenant supply-vs-demand aggregate and returns nothing more than a boolean per
  variety — never a raw pick or order row), and grouping into families is a pure projection of
  whichever variety rows survive that one filter — an empty family structurally cannot render,
  because nothing is filtering at that level at all. Both the main order screen and the
  submission-confirmation popup call this exact function (R6 — "implement it once," not two
  filters that are each supposed to agree); the per-customer carve-out (a variety that went OOS
  after the customer added it stays visible to *them*) is preserved by reading the caller's own
  `daily_orders`/`daily_order_products` rows under their own session (`security invoker`, RLS
  already scopes this to "your own order"), not by a second parameter or a special case.
- **`submit_order`** (R1/R3/R4) is one transaction replacing the source's 5-action,
  dash-packed `save_order_line` workflow (`"<order-id>-<pallets>-<comment>-<line-id>"`, split on
  `-` — a real, documented fragility: an unescaped `-` in a customer's comment corrupts the
  parse and can silently misdirect the edit to the wrong line). The correct behavior — a
  customer can set a pallet count and comment per variety, and zero removes the line — is kept;
  the string-packing mechanism it happened to be implemented with is not. Submitting upserts-
  and-prunes every line in one call (the same shape as `bootstrap_grower_pick`, R3 — a real
  database upsert on `(daily_order_id, product_variety_id)`, never a per-line round trip), sets
  the order to `submitted` (idempotently re-settable — edits after submission are allowed and
  simply re-submit, per the PRD's confirmed behavior), and writes one `order_submission_logs`
  row (the v1.3 audit-log feature, kept as a real append-only table, one row per submission
  event) — all in the same transaction, so a failure partway through is unobservable rather
  than a half-written order. `daily_order_status` (bootstrapped as a placeholder `open`/`closed`
  enum by the lifecycle engine, Prompt 5) is corrected here to the PRD's actual reachable states,
  `open`/`submitted` — the three later states (Scheduled/Out for delivery/Received) are
  aspirational placeholders no workflow ever assigns, matching the same "code is the anchor"
  discipline already applied to `daily_pick_status`. The source's hourly `daily check for empty
  orders` cron sweep (deleting stray zero-quantity order lines) has no equivalent here — it
  existed only because the old per-line save path could leave zero-quantity rows behind;
  `submit_order`'s prune step makes "no zero-quantity `daily_order_products` row ever persists"
  hold by construction, so there is nothing left for a sweep to clean up.

Submission is optimistic on the client (`apps/web/src/routes/customer/order.tsx`): the
confirmation dialog is built from the same local draft state that's about to be submitted, and a
successful `submit_order` call updates the UI directly (invalidate + re-render) rather than a
full-page reload — the source's submit button froze the page for 1–3 seconds and then forced a
reload, a failure mode this shape makes structurally impossible rather than something to remember
to avoid. A Supabase Realtime subscription on `daily_pick_products`/`daily_order_products`
(optional, not required for functional parity) invalidates the catalog query on any change, so
the screen updates live without polling — the client never reads the broadcast row payload
itself, only uses it as a signal to re-run `get_orderable_catalog_for_customer` through the
caller's own RLS-governed session, keeping the same privacy boundary that function already has.
See `packages/db/migrations/0017`-`0019`, `packages/domain/src/customer/` (input schemas, test
fixtures, and direct tests of the mixed-family orderable-catalog rule and concurrent submissions
against a depleting variety), and `apps/web/src/routes/customer/{order,history}.tsx`.

**A test-cleanup bug, found and fixed — not an external Supabase issue after all.**
`packages/domain/src/customer/customer.test.ts`'s actual assertions (the RPC calls and their
results) passed in every run from the start — the migrations and functions were verified correct
throughout. Getting a fully green run of the whole file, though, took real investigation: Supabase's
Auth admin API (`deleteUser`, called by `runCleanup` during `afterEach`) kept returning
`AuthRetryableFetchError`s with HTTP 500 for a subset of the auth users this test file creates,
across several attempts, which initially looked like an external Auth-service capacity issue (no
public incident on Supabase's status page, and isolated retries of the exact same user sometimes
succeeded later). The real cause turned out to be a genuine bug in this file's own cleanup
ordering: `order_submission_logs.submitted_by` references `profiles.user_id` with **no cascade**
(deliberately — the audit log is meant to survive independent of the submitting user's own
lifecycle), and a few of this test file's `it` blocks pushed a customer's user-delete cleanup
*after* the trading day's cleanup, which — because `runCleanup` unwinds in LIFO order — meant
that customer's `profiles` row was deleted **before** the day (and its cascade through
`daily_orders` → `order_submission_logs`) for any customer who had actually called
`submit_order`. Deleting a `profiles` row that a still-live `order_submission_logs` row points at
fails with a real Postgres FK violation; GoTrue's own internal delete hits that same cascade
internally when tearing down `auth.users` → `profiles`, and evidently doesn't turn that failure
into a clear error back to the API caller — hence the opaque 500. Fixed by pushing each test's
`deleteTestTradingDay` cleanup after every sign-in that might have called `submit_order`, not
just after company creation (see the comment on `createOpenTestDay` in that file) — two clean,
back-to-back runs with zero failures and zero fallback triggers confirmed the fix.
`deleteTestUser` (`packages/domain/src/auth/test-helpers.ts`) also picked up two things worth
keeping regardless of this specific bug: it now checks the API response for an error at all
(the original version didn't, so a failed delete silently orphaned rows instead of surfacing
anything), and it falls back to deleting the `profiles` row directly via SQL if the Auth API
still fails after retries — a safety net for whatever *other* transient failure the admin API
might someday have, not a substitute for fixing a real ordering bug when that's what's actually
wrong, which is what this incident turned out to be.

The **arrangement module** is implemented: the distributor's allocation workspace (pooled
supply by variety broken down by grower, pooled demand by variety broken down by customer,
out-of-stock flagging, per-variety price configuration, and arrangement records pairing a
specific grower pick line to a specific customer order line), plus the terminal Close
Arrangement transaction. Three things were the explicit point of this module:

- **`arrangement_records.daily_order_product_id`** (R6) is a genuine precision improvement
  over the source, not a reproduction of it. The source's `dailyarrangementrecords` (confirmed
  via the Bubble Data Dictionary) only ever linked a pick line to the customer *company* —
  never a specific order line — so two order lines for the same variety from the same customer
  couldn't be distinguished by an arrangement record alone. This schema adds the FK the source
  was missing; `customer_company_id` is kept alongside it (denormalized, set once at create
  time) purely so RLS and the notification-outbox aggregation can filter/group without an extra
  join back through the order line every time.
- **`check_arrangement_allocation`** (R1/R6) is one shared guard, called by both
  `create_arrangement_record` and `update_arrangement_record`, that blocks a quantity from
  pushing either side's running total past its own ceiling: a pick line's summed arrangements
  can never exceed its `pallets_picked`, and an order line's summed arrangements can never
  exceed its `pallets_ordered` (`OVER_ALLOCATION`, `P0009`). `update_arrangement_record` passes
  its own record's id as the sum's exclusion, so re-affirming or lowering a quantity never
  self-blocks. This is the PRD's own stated test requirement ("exceeding supply OR exceeding
  the customer's ordered pallet count should be blocked") implemented as one function, not two
  near-duplicate checks that could drift.
- **`close_arrangement`** (R4) is extended, not replaced: `packages/db/migrations/0022`'s
  `create or replace function public.close_arrangement()` adds two more statements to the
  existing Phase-4 body from `0015` — `populate_arrangement_prices` (fills any un-priced
  arrangement record from its variety's fixed price or price-range midpoint, and raises
  `INVALID_STATE`/`P0007` if a record's variety has neither, aborting the whole call) and
  `build_notification_outbox` (writes one durable `notification_outbox` row per grower/customer
  company with arranged pallets, replacing the source's synchronous WhatsApp dispatch). Because
  a `plpgsql` function called from inside another runs in the same transaction by default,
  status change, mass pick-close, leftover computation, price population, and the outbox writes
  all land together or not at all — proven directly in
  `packages/domain/src/arrangement/arrangement.test.ts` by forcing a real pricing failure (an
  arrangement record whose variety has no price or price range configured) and asserting the
  trading day's phase, the arrangement's status, and every pick's status are all still
  unchanged afterward, not just that the RPC call itself returned an error.

`notification_outbox` (R4's external-system carve-out) is a small, durable queue table — no
outbound HTTP call happens inside `close_arrangement`'s transaction at all, so a flaky WhatsApp
API can never roll back a successful close. A later prompt's Edge Function/scheduled job drains
it (matching `notifications`' own placeholder scope) and stamps `sent_at`; nothing here assumes
that drain job exists yet.

No new read-side RPC was needed for the pooled supply/demand views: unlike the customer module
(which needed a `security definer` cross-tenant helper because an ordinary customer session
can't read another tenant's rows), a backoffice session already has full `SELECT` access to
`daily_pick_products`/`daily_order_products`/`arrangement_records`/`product_varieties`/
`companies` via the existing RLS policies from Prompts 5-7. The workspace
(`apps/web/src/routes/backoffice/arrangement.tsx`) reads those tables directly with
plain `.from().select()` calls, same as every other backoffice list/detail screen (e.g.
`distributor-grower/page.tsx`), and does its by-variety/by-grower grouping client-side —
matching the customer catalog's "one function, two groupings" precedent from Prompt 7, just one
level higher (one set of queries, two client-side sort orders) since there's no privacy boundary
here to also collapse. The PRD's "by-grower view" and "by-product view" are this one screen's
view-mode toggle, not two routes; `/backoffice/new-arrangement`
(`apps/web/src/routes/backoffice/new-arrangement.tsx`) is a separate, focused
single-record creation wizard, per the PRD's own `new-arrangement-wizard.md` treating it as its
own screen. Price configuration reuses `save_product` (the same version-guarded, full-row RPC
the Products screen already uses) rather than a new price-only function — a price is just one
field on the variety row, and it deserves the same R7 conflict guard any other edit to that row
gets.

Covered end to end (`apps/web/e2e/arrangement.spec.ts`): a real browser session creates an
arrangement record through the wizard (variety → grower pick line → customer order line →
quantity/price), confirms it appears in the main workspace's records table under both view
modes, confirms Close Arrangement is disabled until the trading day reaches `shop_closed`, and
confirms a real `close_arrangement` call succeeds and the day drops out of the workspace's
"currently active day" query — the same post-close behavior `distributor-grower`'s own
open-day query already has. `create_arrangement_record`'s over-allocation guard has its own
concurrency test, mirroring `close_arrangement`'s (`packages/domain/src/arrangement/
arrangement.test.ts`): two real `rpc()` calls race via `Promise.all`, each requesting a quantity
that alone is within the shared pick line's ceiling but that together would exceed it —
`create_arrangement_record` locks the trading day's `daily_arrangements` row (`select ... for
update`) before it ever sums existing `arrangement_records`, so the loser's allocation check only
runs after the winner's insert has already committed and is visible to it, catching the race for
real rather than relying on request-arrival order.

**A leaked-fixture bug, found and fixed while verifying the above — not the same LIFO-ordering
mistake as the customer ordering module's, and worth naming the difference.** Running this
prompt's full verification (the whole `packages/domain` suite plus the full e2e suite,
back-to-back against the real remote Supabase project) repeatedly left a handful of orphaned,
profile-less `Test Company` rows behind. The customer ordering module's own incident (see that
section above) was a cleanup-*ordering* bug — a resource whose delete was pushed to `cleanupFns`
in the wrong position relative to something it depended on. This one wasn't an ordering problem
at all: five call sites in `packages/domain/src/lifecycle-engine/lifecycle.test.ts` created a
throwaway company inline — `createTestProfile({ companyId: (await createTestCompany()).id, role:
"backoffice" })` — and never captured the company in a variable, so there was no reference left
to ever push a `deleteTestCompany` call for in the first place. The corresponding profile/auth
user WAS captured and reliably cleaned up, which is exactly why the leaked rows were always
company shells with zero attached profiles, never a company with a still-live profile pointing at
it — a distinguishing signature that pointed at "never targeted for cleanup," not "targeted but
blocked by an FK." Fixed by adding `createTestBackofficeAdmin`/`deleteTestBackofficeAdmin`
(`packages/domain/src/auth/test-helpers.ts`) — a bundled helper that creates the company and the
profile together and returns both, so there is no longer a separate "company" variable for a
caller to forget to capture — and switching all five call sites to it. This closes the failure
mode structurally rather than just fixing the five known instances: the same throwaway-company
shape can't be written again through this helper, because the helper is the only thing that ever
holds a reference to the company it creates. `signedInBackoffice()`-style helpers elsewhere
(`customer.test.ts`, `grower.test.ts`, this module's own file) already captured their company in
a variable and pushed its cleanup, so they were never at risk of this specific bug — they were
left as-is rather than migrated to the new helper, since there was nothing broken to fix there.
One further, smaller leak survived even after this fix (a single profile-less company from one
run) — that one carries the same signature as the residual, already-documented `deleteTestUser`
Auth-API flakiness from the customer ordering module's incident (the profile delete's own
fallback path can still, rarely, throw after already succeeding, aborting whatever cleanup was
queued after it), not a new bug.

The **notifications module** is implemented: a NotificationService (a swappable
`NotificationChannel` behind one WhatsApp adapter), the in-app Alerts delivery log, and the
WhatsApp dispatch that drains `notification_outbox` (Prompt 8) after `close_arrangement`'s
transaction has already committed. Three things were the explicit point of this module:

- **Templates stay two tables, not one — verified, not assumed.** The source stores outbound
  templates in two places: an admin-configurable "Alert Types" bank and a separate "main alert"
  lookup WhatsApp dispatch pulls by id. Before merging them, the PRD's own field-by-field entity
  tables (`reference/prd/alerts-and-alert-templates.md`) were compared directly: Alert Types has
  no placeholder-substitution field at all (an Alert renders `main_text` alongside its own typed
  `number_for_display`/`full_name_for_display`, never a find/replace target) and a structured
  in-app navigation target (`app_screen` + `url_parameter`); `main alert` has exactly one
  placeholder-bearing `content` string (`%FIRST_NAME%`/`%ORDER_DETAILS%`/
  `%CURRENT_OPEN_BUSINESS_DAY%`/`%NL%`) and a raw outbound `link` URL, referenced by a small,
  stable set of code-known keys rather than admin-authored on demand. Different substitution
  model, different navigation model, different lifecycle (Alerts persist as a delivery log;
  `main alert` is a transient dispatch-time lookup with no delivery record of its own), different
  lookup mechanism. They stay two tables: `alert_types` (`packages/db/src/schema/alert-type.ts`)
  and `notification_templates` (the renamed `main alert`,
  `packages/db/src/schema/notification-template.ts`). See `docs/SCHEMA_DECISIONS.md` for the full
  comparison.
- **The business logic lives in Postgres, not in the Edge Function.** `resolve_outbox_dispatch`
  and `substitute_template_placeholders` (`packages/db/migrations/0024`) do the actual work — which
  send targets a `notification_outbox` row resolves to (the company's WhatsApp group if
  `whatsapp_group_id` is set, otherwise one target per individual user with a `phone_number` on
  file, 972-prefixed with the leading 0 stripped, per `close-arrangement-phase-4-terminal.md`
  actions 7/8) and the per-recipient `%TOKEN%` substitution. Both are tested directly against the
  real database (`packages/domain/src/notifications/notifications.test.ts`), the same way every
  other function in this project is — not left untested inside a Deno runtime this project has no
  test harness for. `supabase/functions/whatsapp-dispatch/index.ts` (the actual WhatsApp adapter)
  is deliberately thin: fetch pending outbox rows, call `resolve_outbox_dispatch`, POST to the
  WhatsApp API via plain `fetch`, record the outcome. Its own drain loop is not a direct import of
  `packages/domain/src/notifications/drain.ts` — Deno can't resolve that package's other
  workspace-aliased imports (`@ori/db`, `drizzle-orm`) without a bundler this project doesn't have
  set up — but calls the identical Postgres functions, so the part with real logic to get wrong is
  tested once, not reimplemented untested. `drain.ts` itself (a Node-side, fully-tested
  orchestrator using only a type-only `SupabaseClient` import plus the dependency-free
  `NotificationChannel` contract) exists as the swappable-channel demonstration the task asked
  for, and as a reusable orchestrator for any future Node-hosted caller. The Node-side channel,
  `createGreenApiChannel`, mirrors the Edge Function's own Green API send exactly and is used
  by apps/api for the one message that must go out synchronously — the admin-mediated password
  reset's recovery link, sent to the user's own WhatsApp
  (`packages/domain/src/auth/whatsapp-recovery-delivery.ts`); it is exercised by pure tests with
  a stubbed `fetch`, while `drainNotificationOutbox`'s retry/toggle-gating logic is exercised
  fully via a
  `FakeNotificationChannel` test double. This is the "real retry/observability" this module
  replaces the source's single-hardcoded-email dead-letter with (see `whatsapp-messaging.md`'s
  own documented operational risk): `notification_outbox.attempt_count`/`last_error`/
  `last_attempted_at` accumulate a visible history instead of silently vanishing into one
  unmonitored inbox.
- **Alerts' privacy gap is closed from the start, as an RLS policy — not an application filter.**
  The PRD flags Alerts' own privacy rule as likely defaulted to "everyone" in the source, never
  fixed. `packages/db/migrations/0023` gives `alerts` `intended_for_user_id = auth.uid()` on both
  the `select` and the mark-as-read `update`, with no `insert`/`delete` policy for `authenticated`
  at all — every row is written by `create_alert` (`security definer`, backoffice-only caller),
  matching `order_submission_logs`' closed-to-raw-writes shape. Confirmed directly: a signed-in
  customer can read and mark-read their own alert but gets an empty result (not an error) reading
  or updating another customer's (`notifications.test.ts`'s RLS test). One real bug surfaced and
  was fixed during this same verification pass: `alert_types` was originally RLS'd
  backoffice-only for every operation, including `select` — but a recipient's own client needs to
  read their alert's `alert_types` row (`main_text`, `app_screen`, ...) to render it at all, under
  their OWN session, not backoffice's. With no non-backoffice `select` policy, that embedded
  PostgREST join silently resolved to `null` for every non-backoffice user — an alert existed
  (Alerts' own RLS already permitted seeing it) but rendered as empty text with no navigation
  target, caught by the e2e spec (`apps/web/e2e/alerts.spec.ts`) before being shipped, not by a
  unit test (the domain-level RLS test signs in as a real user and reads via `.rpc()`/`.from()`
  directly, but never rendered the embedded join the way the actual client does). Fixed in
  `packages/db/migrations/0025`: `alert_types` now allows `select` for any authenticated user
  (it holds no tenant-sensitive data — admin-authored template copy and a route string — the same
  shape as `product_families`), with writes still backoffice-only.

`notification_settings` (`packages/db/src/schema/notification-settings.ts`) is a genuine
two-boolean singleton — `whatsapp_enabled` (global) and `close_arrangement_whatsapp_enabled`
(the close-arrangement dispatch specifically; both must be true for that dispatch to send, per
`whatsapp-messaging.md`) — checked at **drain time**, not at the moment `close_arrangement`
writes the outbox row: a row is always written transactionally regardless of toggle state, and
the drain job (Node's `drainNotificationOutbox` or the Edge Function) decides whether to actually
send based on the toggles' current value. This is not the R2 "app settings god object" pattern:
that anti-pattern was a singleton of "active_X" pointer fields duplicating state a live query
already answers; these two booleans have no live-query equivalent, they're genuine
admin-configurable feature flags, the same kind of thing `companies.can_see_product_prices`
already is, just not scoped to one row of another table. The `id boolean primary key default
true, check(id)` shape makes a second row structurally impossible, not just conventionally
avoided.

`build_arrangement_alerts` (`packages/db/migrations/0024`), called from `close_arrangement`
alongside `build_notification_outbox`, is the in-app counterpart: one `alerts` row per individual
grower/customer **user** (never a company or a WhatsApp group — read/unread state is inherently
per-recipient) with arranged pallets for the day. Deliberately **not** gated by the WhatsApp
toggles — `send_as_whatsapp` and `send_as_notification` are independent on both Alert Types and
Alerts in the source, and a user should see their in-app alert regardless of whether outbound
WhatsApp happens to be globally enabled. Both `build_notification_outbox` and
`build_arrangement_alerts` are plain table inserts, no network call, so both stay inside
`close_arrangement`'s own transaction (R4) exactly like every other step already extended into it
across Prompts 8-9.

The in-app alert bell (`apps/web/src/components/shell/alerts-bell.tsx`) is mounted once per role
shell (`BackofficeNav`, `RoleShell`) so it's visible regardless of which screen is open: an
unread-count badge, a dropdown listing every alert (RLS already scopes the query to the signed-in
user's own rows — there is no client-side filter to get wrong), and clicking an alert marks it
read (a plain `.update({ read: true })` call, RLS-gated, the same "simple self-service write
needs no RPC function" precedent `change-password/page.tsx` already set) and navigates to the
alert type's `app_screen` (with `display_record_id` attached as `url_parameter` when set).
Covered end to end (`apps/web/e2e/alerts.spec.ts`): a real signed-in session sees the badge, opens
the dropdown, clicks the alert, lands on the deep-linked screen, and the badge clears — the clear
only happens once the RLS-scoped update round-trips and the list is refetched, not from local
optimistic state, so a silently-rejected write would leave the badge showing 1, not 0.

See `packages/db/migrations/0023`-`0025`, `packages/domain/src/notifications/` (schemas, the
`NotificationChannel`/`createGreenApiChannel` adapter, `drainNotificationOutbox`, test fixtures
including `FakeNotificationChannel`, and the full test suite), `supabase/functions/
whatsapp-dispatch/` (the actual Edge Function), and `apps/web/src/components/shell/alerts-bell.tsx`.

**Deployed and live-tested, in a later turn.** `supabase functions deploy` needs a Supabase
Personal Access Token (Management API auth, distinct from every data-API key already in `.env`) —
not Docker, contrary to this section's own earlier assumption; `--project-ref` alone was enough
once a token was supplied. Deployed successfully, `WHATSAPP_ENV`/`WHATSAPP_DEV_ID_INSTANCE`/
`WHATSAPP_DEV_API_TOKEN` set as Edge Function secrets (Green API — `sendMessage` is a plain POST to
`https://api.green-api.com/waInstance{idInstance}/sendMessage/{apiToken}` with a `{chatId,
message}` body, `{phone}@c.us` for an individual chat), and invoked once for real against a
genuine pending `notification_outbox` row addressed to a real phone number: the function reported
`sent: 1`, the outbox row's `sent_at` was set with `attempt_count: 0`/`last_error: null`, and the
active credential set (`WHATSAPP_DEV_*`, confirmed via the function's own server-side-only log
line, never in the HTTP response) matched what was configured — the full pipeline (fetch pending
row → `resolve_outbox_dispatch` → real Green API send → record outcome) verified end to end, not
just unit-tested against the Postgres functions in isolation. `WHATSAPP_LIVE_*` remain deliberately
unset.

## Pre-cutover verification (Prompt 10)

Four things, none of which changed a single business rule already implemented — this pass verified
what's here, fixed one real regression it found along the way, and produced the documents a human
needs before retiring the Bubble app. See `docs/PERFORMANCE_VERIFICATION.md`,
`docs/DATA_MIGRATION_PLAN.md`, and `docs/UAT_CHECKLIST.md` for the full accounts; summarized here.

**Test coverage, audited against the PRD's own stated invariants, not just re-derived from the
Bubble app's click-path.** All five `lifecycle-invariants.md` invariants, the orderable-catalog
rule, and Close Arrangement's all-or-nothing guarantee already had explicit, named tests from
Prompts 5-8 — this pass read every relevant PRD flow doc and cross-checked test-by-test rather than
assuming coverage from memory, and found two real, worth-closing gaps: `arrangement.test.ts`'s
all-or-nothing test asserted three tables' state after a forced mid-transaction failure but never
checked `lifecycle_sessions`/`notification_outbox` — the two things closest to Invariant 5's own
point (a Session should never exist for a transition that didn't complete) — now asserted directly;
and `adminResetPassword` had role-guard tests (`apps/api/src/routers/auth.test.ts`) but nothing
confirming its actual effect (the target's `must_change_password` flag, a real deliverable recovery
link) — added in `packages/domain/src/auth/admin-reset-password.test.ts`.

**Performance claims verified with real measurements, not assumed from the rebuild's shape.**
Route-per-screen navigation and RPC-based writes *look* like they should fix the source's
documented tab-switching/expand-lag/submit-freeze issues — this pass actually measured each one
(`apps/web/e2e/performance-verification.spec.ts`) rather than treating the architecture as
self-evidently sufficient, and that measurement caught a real regression: React Query's factory
default (`staleTime: 0`) meant re-visiting an already-viewed customer order row silently fired a
second background query every time — invisible in the UI (cached data shows instantly), visible
only in the network tab. Fixed with one line (`apps/web/src/lib/providers.tsx`, a 30-second default
`staleTime`), confirmed by measuring the same scenario before and after the fix (2 requests → 1).

**A live-data finding that corrects earlier documentation.** Inspecting the actual production
Bubble project (via st4ck's `bubble_get_schema`/`bubble_list_records` tools) for the migration plan
surfaced that the source audits five session types (`initiate day`/`open shop`/`close shop`/
`end the day`/`update`), not the two this file and `lifecycle-invariants.md` both previously stated
("phases 1 and 2 are not audited in the source either") — that claim was simply wrong, caught only
by reading real data instead of trusting the written PRD. `lifecycle_session_type` is extended
(`packages/db/migrations/0027`) with three `historical_*` values so a faithful migration is
possible without lossy remapping; this rebuild's own functions still only ever write `close_shop`/
`end_the_day` — whether to start auditing phases 1/2 for real is a separate, undecided product
question, not something this migration silently opted into.

**Two real, pre-existing gaps surfaced by working through the PRD's six flows end to end**, neither
touched in this pass since fixing them wasn't the ask: `/profile` (self-service name/phone/email
editing, `reference/prd/edit-profile.md`) is still a bare scaffolding placeholder, never built in
any earlier prompt; and the backoffice's `/backoffice/distributor-customer` +
`/backoffice/order-history` screens (the literal location of the source's Issues 3-5) are likewise
still placeholders, meaning this pass's performance verification for those specific issues had to
be measured against the architecturally-equivalent customer-facing screens instead (see
`docs/PERFORMANCE_VERIFICATION.md`'s own scope note) — re-run that spec against the real screen
once it exists. Both are recorded as open, named items in `docs/UAT_CHECKLIST.md` rather than
silently absorbed into this prompt's scope.

## The three screens Prompt 10 flagged as gaps

`/profile`, `/backoffice/distributor-customer`, and `/backoffice/order-history` — built the same
prompt that named them as gaps, closing every open item from the previous section.

**`/profile`** — a single-table self-write (`profiles.display_name`/`phone_number`), covered
entirely by the existing `profiles_update_own` RLS policy (0003). No RPC: R4's transaction
requirement is for multi-field edits that need one, and this is one `UPDATE` against a row the
caller already owns — the same shape `/change-password`'s own `must_change_password` self-write
already established. Email is deliberately excluded even though the PRD's field list includes it —
it lives in `auth.users`, not `profiles`, and the source's own flow persists email changes with no
verification step at all; porting that unverified behavior wasn't asked for and isn't done here.

**`/backoffice/distributor-customer`** (Customer Order Status) — structurally mirrors
`/backoffice/distributor-grower` from Prompt 6: no dedicated PRD doc beyond `backoffice.md`'s
one-line table entry, built by reusing the customer's own order-taking logic under a backoffice
session rather than a second implementation. That reuse required extending two functions that were
previously customer-only by design, not just by convention:

- **`get_orderable_catalog_for_customer`** (0018) originally took no target-company parameter at
  all — its own comment explained that omitting the parameter entirely, not just relying on RLS,
  "removes the spoofing surface entirely." Migration 0028 adds an optional
  `p_customer_company_id`, converts the function from `language sql` to `language plpgsql` to add
  an explicit check, and preserves the original intent exactly: a non-backoffice caller supplying
  *any* non-null value is rejected with `FORBIDDEN` before the query ever runs, not silently
  filtered. Every existing customer call (parameter omitted) is byte-for-byte unchanged.
- **`submit_order`** (0018) was strictly `current_role() = 'customer'`, with no on-behalf-of path —
  unlike the grower module's `update_pick_product_pallets`/`_details`, which already supported "the
  owning grower, or backoffice." 0028 closes that asymmetry the same way: an optional, backoffice-
  gated `p_customer_company_id`. `order_submission_logs.submitted_by` still always records
  `auth.uid()` — whoever actually called it — never the order's own company, matching how the
  grower module already attributes on-behalf-of edits to the real actor.

Both extensions are exercised by the same `submit_order`/`get_orderable_catalog_for_customer` RPC
calls the customer's own screen makes — see `OrderLinesEditor`
(`apps/web/src/components/customer/order-lines-editor.tsx`), extracted from what was previously
`/customer/order/page.tsx`'s inline logic so both screens share one component, the same precedent
`PickLinesEditor` set for the grower module. The performance requirement Prompt 10 couldn't verify
because this screen didn't exist yet (Issue 3, `tab=distributor+customer`) now has a real
measurement against the real screen: `apps/web/e2e/distributor-customer.spec.ts` confirms
re-selecting a previously-viewed customer fires zero additional catalog requests, via the same
30-second `staleTime` fix Prompt 10 already put in place — see `docs/PERFORMANCE_VERIFICATION.md`'s
own note to re-run against this screen once built.

**`send_order_reminder`** (0028, new) — the distributor's "remind this customer" action, mirroring
`send_pick_reminder`'s shape (lock the row, check not-already-submitted, stamp
`daily_orders.reminder_sent_at`) but at the time with one real difference: `send_pick_reminder`
predated the notifications module (Prompt 9) and was left a dispatch-less stub by design;
`send_order_reminder` didn't have that excuse, so it also wrote a real `notification_outbox` row
(`template_key = 'order_reminder'`). That asymmetry was closed in a follow-up pass:
`send_pick_reminder` (0029) now dispatches the same way (`template_key = 'pick_reminder'`, wording
adapted from the live `mainalert` ids 1/2), tested the same way in
`packages/domain/src/grower/grower.test.ts`. Both reminder functions now behave identically —
stamp-and-dispatch, not stamp-only.

**`/backoffice/order-history`** (Arrangement + Orders History by Date) — read-only, backed entirely
by RLS policies that already existed (`daily_orders_select_backoffice`,
`daily_order_products_select_backoffice`, `arrangement_records_select_backoffice`, all from
0010/0017) — no new policy needed. Pick a date, see every customer's order for that trading day,
drill into a line to see pallets ordered vs. pallets actually arranged (`arrangement_records`,
joined via `daily_order_product_id` — the precise link Prompt 8 added specifically because the
source's `dailyarrangementrecords` never had one) side by side, for dispute resolution.

**The `mainalert` gap-mapping question, resolved against the live data a second time** (Prompt 10's
migration plan had gotten one row wrong): of the 11 `mainalert` rows, id 5 ("this is a reminder to
send an order for day X") is the customer order reminder — closed by `send_order_reminder` above,
not a grower message as `docs/DATA_MIGRATION_PLAN.md` originally (incorrectly) grouped it with ids
1/2. The remaining eight ids (1/2 as one shared trigger, plus 3, 4, 6, 8, 10, 11) were closed in a
follow-up pass — see the next section.

RLS coverage for both backoffice screens — proving a non-backoffice role really can't reach what
they read, not just asserting it — lives in
`packages/domain/src/customer/backoffice-order-screens-rls.test.ts`.

## The remaining six mainalert triggers

Every `mainalert` id `docs/DATA_MIGRATION_PLAN.md` § 3b still listed as unbuilt, closed in one pass,
all through the existing NotificationService/outbox pattern (Prompt 9) — no new dispatch mechanism.
R5 held throughout: every state-crossing check happens inside the write-path function that could
have caused it, computed synchronously in the same transaction, never a trigger watching for the
change after the fact.

**`send_pick_reminder` retrofitted (ids 1/2).** Mirrored `send_order_reminder`'s already-built
shape exactly: alongside the existing `reminder_sent_at` stamp, it now also writes one
`notification_outbox` row (`template_key = 'pick_reminder'`). It had been left a dispatch-less stub
specifically because the notifications module didn't exist yet when it was written (Prompt 6) — that
excuse no longer applied once Prompt 9 landed, and this closes the asymmetry `docs/
SCHEMA_DECISIONS.md`'s Customer Order Status entry explicitly flagged as still open.

**`shop_open`, customer-facing (id 4).** `open_shop` enqueues one `shop_open` row per active
customer company, in the same `insert ... select` shape (and the same transaction) its own
`daily_orders` bootstrap immediately above it already uses.

**A backoffice-wide "notify the distributor" pattern, established once (ids 3, 6, 10, 11).**
Backoffice is a role, not a single company — nothing in this schema enforces exactly one
backoffice-typed company — so "notify backoffice" means "one outbox row per active backoffice
company." `enqueue_backoffice_notification` (`packages/db/migrations/0031`) is that one pattern,
reused by all four triggers rather than four independent queries. It's deliberately **not** granted
to `authenticated` — it's an internal helper only ever called from within another `security
definer` function, never a legitimate direct client RPC target; granting it broadly would let any
authenticated caller enqueue an arbitrary `template_key`/payload addressed to backoffice.

- **id 3** — `update_pick_product_pallets` enqueues `pick_updated`, but only when the GROWER
  themselves made the edit (`current_role() = 'grower'`), never on the backoffice-on-behalf-of path
  (distributor-grower) — notifying backoffice about backoffice's own action would be pointless.
- **id 6** — `submit_order` enqueues `order_submitted` the same way: only on a direct customer
  submission, never when backoffice submits on a customer's behalf. Opposite direction from id 5.

**Live-computed out-of-stock/overbooking alerts, not a stored list (ids 10/11).** This project's
`get_orderable_catalog_for_customer` design already rejected a stored out-of-stock list once — that
was the actual fix for the source's CREATE-vs-UPDATE trigger bug (0018's own header comment).
Extending that same discipline: `submit_order` computes, immediately after writing the order lines
that could have caused it, whether a variety just crossed a threshold — comparing global demand
before and after this specific call, per touched variety (only a line whose pallet count *increased*
this call can possibly cause a forward crossing; removing/reducing a line only frees up room). A
customer's own order submission is the only event that can cause either crossing, so the check lives
entirely inside `submit_order`'s own transaction, regardless of whether the direct-customer or
backoffice-on-behalf-of path was used (unlike ids 3/6, this isn't a self-notification concern — it's
a real inventory event either way). `stock_overbooking_reached` (id 10) fires once demand reaches
base supply while overbooking room remains; `stock_fully_exhausted` (id 11) fires once that
overbooking room is also consumed.

**`close_arrangement`'s transporter cc (id 8).** `build_notification_outbox` gained a third insert:
any grower with `companies.transporter_company_id` set gets an identical `close_arrangement_grower`-
templated row cc'd to their transporter — the same template content the grower's own row uses, one
message per grower even when a transporter serves several (not a consolidated multi-grower message).
`transporter_company_id` itself (a self-referencing FK on `companies`) was a genuine, pre-existing
PRD gap: `reference/prd/company.md`'s own field table never listed it, despite the live
`company.Transporter` field being populated on real grower rows.

**Follow-up, same day: the field had no UI to set it.** id 8's notification only fires for a grower
whose `transporter_company_id` is actually populated — and nothing in `apps/web` could set it; the
only write path was a test fixture's direct `db.update()`. `save_grower` (0033, same "drop then
recreate" discipline as 0031's own signature-change fix, plus a same-function validation that the
supplied id is actually a `type = 'transporter'` company) now accepts it, and the Growers screen got
a "מוביל" dropdown listing active transporter companies. `distributor-grower`'s own products-only
save dialog reads and re-passes the grower's current `transporter_company_id` unchanged — `save_grower`
replaces the whole row, so leaving it out of that call would have silently wiped any existing
assignment every time backoffice edited a grower's in-season products from that screen.

**One new placeholder token, not four.** `substitute_template_placeholders` gained `%COMPANY%` (a
third party the message is *about* — the grower who updated their pick, the customer who submitted —
distinct from `%FIRST_NAME%`, which is always the recipient's own identity) plus
`%PRODUCT_NAME%`/`%PRODUCT_OVERBOOKING%` for ids 10/11. `%PICKUP_TIME%`/`%COMPANY_USER_FULL_NAME%`
(present in the live `mainalert` rows) were never needed — ids 6/8's rebuilt triggers use simplified
wording rather than porting that content byte-for-byte, the same choice already made for ids 7/9's
`close_arrangement_customer`/`_grower` templates.

**Housekeeping found along the way.** Extending a function's signature via `create or replace
function` only replaces it when the argument list matches exactly — adding parameters (even with
defaults) silently creates a dead, unreachable second overload instead. That had already happened
once, silently, when `get_orderable_catalog_for_customer` and `submit_order` picked up their
`p_customer_company_id` parameter — both original signatures were still sitting in the schema,
unreachable. Cleaned up (`drop function if exists ...`) as part of this same migration, before
`substitute_template_placeholders` picked up its own new parameters the same way.
