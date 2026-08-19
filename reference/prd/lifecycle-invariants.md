---
title: "Lifecycle Invariants"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The four-phase trading lifecycle has invariants that must hold between phases. These are derived from the actual workflow actions; tests should treat them as contracts.

## Invariant 1 — Exactly one Daily Shop per trading day

A given date has at most one Daily Shop record in the "active" position on App Settings. `creating_daily_shop_data` enforces this via its action-1 guard; `open_shop` does not have the guard but is only meant to be called once per day.

Violations: two Daily Shops for the same date (a bug, almost certainly a race condition or double-click on Open Shop).

## Invariant 2 — Phase progression is forward-only within a single trading day

`day_status` is forward-only within a single trading day. `visible_buttons` cycles — close_arrangement resets it back to `open` so the next day can be initiated.

```
within one day:
  visible_buttons:   open → awaiting → closed → close_arrangement → (then back to open at close_arrangement)
  day_status:        ? → open → (unchanged through phases 2/3) → closed → (back to "open" at next day's initiate)
```

Reverse progression _within a day_ (e.g., `visible_buttons` going from `close_arrangement` back to `closed` mid-day) is a bug. The reset at close_arrangement is by design and not a reversal — it ends one day and prepares the next.

## Invariant 3 — Active references are populated until close_arrangement, then cleared/reset

Between phases 1 and 4, the App Settings fields `active_daily_arrangement`, `active_daily_shop`, `active_daily_pick_data_list`, and `list_of_active_daily_order_data_list` must be populated (with the day's records).

After close_arrangement (phase 4), **seven** App Settings fields are reset by Action 2 of the workflow:

| Field                                  | After close_arrangement          |
| -------------------------------------- | -------------------------------- |
| `active_daily_arrangement`             | empty                            |
| `active_daily_shop`                    | empty                            |
| `active_daily_pick_data_list`          | empty                            |
| `list_of_active_daily_order_data_list` | empty                            |
| `visible_buttons`                      | `open` (ready for next initiate) |
| `day_status`                           | `closed`                         |
| `shop_status`                          | `close`                          |

A test that verifies "the day was closed cleanly" must check all seven fields, not just the four "active" references.

A non-empty active reference at the start of a new initiate is evidence the previous day was not closed cleanly.

## Invariant 4 — Pick status mirrors lifecycle phase

- Phase 1–2: Picks are in **Draft** (or **Submitted** if grower has submitted).
- Phase 3: Picks are in **Submitted** (the grower may continue editing the pick's line items, but the status remains).
- Phase 4: Picks are mass-updated to **Closed** by close_arrangement action 5.

A pick stuck in Draft when the day reaches phase 4 indicates either a grower never submitted (legitimate) or a bug.

## Invariant 5 — Session records mark every close action — but the timing differs

Each call to `close_shop` produces a Session with type `close_shop`. Each call to `close_arrangement` produces a Session with type `end_the_day`. **But the workflows create the Session at different points:**

- **close_arrangement**: Session is **Action 1** — created BEFORE any side effects. If the workflow fails partway, the Session exists but the work is not complete. Operationally a Session here means "this was attempted at time T", not "this completed successfully".
- **close_shop**: Session is **Action 3** of 3 — created AFTER the App Settings and Daily Shop changes. If the workflow fails partway, the Session may NOT exist. A close_shop Session here implies "all three actions succeeded".

This asymmetry matters operationally and for tests:

- Tests of close_arrangement partial failure may find an orphan Session.
- Tests of close_shop partial failure should NOT find a Session — its absence is the signal that the close didn't finish.

## Test implications

- Lifecycle tests must verify all five invariants — not just the focal change of each phase.
- A regression test for "the previous day cleaned up properly" can be encoded as Invariant 3 at the start of a new initiate.
- Concurrency tests (two Distributors pressing the same lifecycle button simultaneously) should verify Invariants 1, 2, and 5 still hold.
