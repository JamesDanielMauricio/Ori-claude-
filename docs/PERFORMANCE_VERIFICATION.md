# Performance Verification Report

Measured, not assumed. Source: st4ck spec "Performance Issues — Identified Bugs & Fixes" (5
issues, effort/gain-ranked). Measurements captured via
`apps/web/e2e/performance-verification.spec.ts` against a real production build, not a dev
server. Numbers below are from the run on 2026-07-12.

> **These numbers are a pre-migration baseline.** They were taken against the Next.js
> production build (`next build` + `next start`), which `apps/web` no longer uses — it moved to
> a Vite/React SPA on 2026-09-08 (see `docs/ARCHITECTURE.md`). The measured *criteria* still
> apply and the spec still runs; re-run it against `vite build` + `vite preview` to get current
> figures. Expect navigation timings to improve rather than regress: the dominant cost in the
> table below was a per-navigation server round trip (`requireRole()`'s two sequential Supabase
> calls on every protected layout render) that the SPA does not make at all.

## Scope note — read before the results

Issues 3, 4, and 5 in the source spec are all specifically located at `tab=distributor+customer`
— the backoffice's "Distributor as Customer" order-management view. That screen
(`/backoffice/distributor-customer`) and its sibling order-history screen
(`/backoffice/order-history`) **remain unbuilt placeholders** in this rebuild (never scoped into
any prompt so far) — they cannot be measured because they don't exist yet.

What *is* measured below is the same **underlying pattern** (client-side route navigation instead
of one all-tabs page; a cached detail query instead of a live re-search on every expand; an RPC
call instead of a blocking mid-workflow wait + full page reload) verified against the screens that
*do* implement it today: the backoffice's route-per-screen navigation generally (Issue 2, a direct
match — that issue was about backoffice tab-switching specifically, not scoped to one tab), and the
customer-facing order/history screens (a structural stand-in for Issues 3-5, which share the exact
same React Query + Postgres-RPC architecture the eventual `/backoffice/distributor-customer`
screen will also use). When that screen gets built, re-run this same measurement against it
directly — the numbers below don't transfer automatically to a screen that doesn't exist yet, but
the architecture that produced them does.

## Issue 2 — Tab switching lag

**Source claim:** all 11 tabs live on one page; switching forces a full condition sweep across 142
repeating groups, up to 16 nested per tab. Acceptance criterion: **≤ 1 second, no visible freeze.**

**Rebuild:** each backoffice screen is a real route (`src/routes/backoffice/*`, lazily code-split
in `src/app-routes.tsx`), not
a tab inside one page. Navigating between them is a client-side route transition; the destination
route's own data fetch is the only work that happens.

**Measured** (shop → products, `getByRole("link").click()` to destination content visible):

| Run | Elapsed |
| --- | --- |
| 1 (cold, right after a fresh `next start`) | 858ms |
| 2 (warm) | 229ms |
| 3 (warm) | 243ms |
| 4 (warm) | 234ms |
| 5 (warm) | 247ms |

All under the 1-second criterion, including the cold-start outlier. Warm-state median ~240ms — the
condition-sweep-across-142-RGs failure mode has no equivalent to reproduce: this route only ever
evaluates its own component tree, never the other ten screens'.

**No full navigation occurred**: an in-memory `window.__navMarker` value set before the click
survived after arriving at the destination — a real full-page navigation (the failure mode Issue 2
was actually describing, one layer below "it's slow") would have wiped it regardless of how fast
the reload happened to be. This is a stronger claim than "it was fast" — it's "no browser-level
navigation happened at all," which is what makes it structurally impossible to regress back to a
142-RG sweep by any code that keeps `/backoffice/*` as client-side routes.

## Issue 3 / 5 — Expand/collapse lag, unfiltered pre-load query

**Source claim:** every row expand fires 2 fresh sequential DB queries; a `Popup data` container
meant to pre-load and dedupe those queries loads the whole table unfiltered and is never actually
wired up to the components that need it. Acceptance criterion: **no DB query fires when expanding
a row that's already been viewed.**

**Rebuild (measured against `/customer/history`'s row-select pattern, per the scope note above):**
selecting order A fires exactly one request to `daily_order_products`; selecting order B fires one
more; re-selecting order A fires **zero** additional requests, reusing the cached result.

**This required a real fix, found by this exact measurement, not assumed to already work:**

| | Requests for order A, 1st view | Requests for order A, on revisit |
| --- | --- | --- |
| Before fix (React Query factory default, `staleTime: 0`) | 1 | **2** |
| After fix (`staleTime: 30_000` set globally, `apps/web/src/lib/providers.tsx`) | 1 | **1** |

React Query's default `staleTime: 0` means every query is stale the instant it lands — revisiting
an already-cached order still shows the cached data instantly (no visible spinner), but silently
fires a background refetch anyway. That's a real, measured instance of exactly the "no DB query on
re-expand" requirement being violated, just less visibly than the source's own version (a spinner
every time) — the network tab doesn't lie even when the UI looks fine. Fixed by setting a 30-second
default `staleTime` on the shared `QueryClient`. `invalidateQueries` (used after every mutation and
by the customer catalog's Realtime subscription) forces a refetch regardless of `staleTime`, so
this doesn't make any "show the fresh data after a write" behavior stale — it only stops an
*unmodified* row from re-querying itself on every re-visit within the window.

## Issue 4 — Submit order freezes the page

**Source claim:** three compounding problems — a blocking mid-workflow server wait, the
confirmation popup closing before the writes that were supposed to precede it, and a
`ChangePage → Current page` full reinitialization after submit. Acceptance criteria: the popup
closes promptly, no full page reload, the list reflects the new state without one.

**Rebuild:** `submit_order` is one Postgres function (one round trip, one transaction, R4) called
via `supabase.rpc()`; a successful response updates React Query's cache directly — there is no
`window.location.reload()`/`router.refresh()`-equivalent anywhere in this path.

**Measured** (click "שלח הזמנה" → confirmation toast visible): 232-367ms across three runs.

**No full page reload occurred** — same `window.__navMarker` technique as Issue 2, confirming the
in-memory marker survived the submit. This directly answers the source's own three-way breakdown:
there's no blocking mid-workflow wait to remove (the whole write is the one RPC call), the popup's
close and the write's completion are the same event (the toast only fires after the RPC resolves),
and there's no `ChangePage` because there's no page to change — the same route re-renders with the
already-fetched, now-invalidated data.

## Issue 1 — Skeleton loader animation (not independently measured)

Source: `background-position` CSS animation / SVG SMIL `<animate>`, both causing per-frame main-
thread repaints. This project's `Skeleton` component (`apps/web/src/components/ui/skeleton.tsx`,
built once in the shell work and reused everywhere) already uses a GPU-composited `transform`
animation, matching the source's own stated fix — confirmed by reading the component, not
independently re-measured with a paint-timing tool in this pass. Lowest-priority issue in the
source's own effort/gain ranking; no SMIL animation exists anywhere in this rebuild's SVG usage to
begin with (no SVG loaders are used at all).

## Summary

| Issue | Source's acceptance criterion | Rebuild result |
| --- | --- | --- |
| 1. Skeleton animation | GPU-composited, no SMIL | ✅ by construction (shared component, not independently re-measured) |
| 2. Tab switching ≤ 1s | ≤ 1000ms, no freeze | ✅ 229-858ms measured, no full navigation |
| 3. No query on re-expand | 0 new queries on revisit | ⚠️→✅ real regression found (2 requests), fixed (`staleTime: 30_000`), re-measured at 1 request |
| 4. No freeze/reload on submit | Popup closes promptly, no reload | ✅ 232-367ms, no full navigation |
| 5. Pre-load wired correctly | Filtered pre-load, no duplicate queries | ✅ same `staleTime` fix — the pre-load pattern this issue asked for is what React Query's cache already does once configured correctly |

Three of five issues have no literal screen to re-test against yet (§ Scope note) — re-run this
spec against `/backoffice/distributor-customer` once it's built, rather than assuming this report's
numbers still apply to a different implementation.
