---
title: "Pick Status Transitions"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A Daily Pick is always in one of three states: **Draft**, **Submitted**, **Closed**. Transitions are linear and forward-only.

## Draft → Submitted

- **Triggered by:** the grower submitting from the pick-edit popup.
- **Effects:**
  - Submission Time is stamped.
  - An entry is appended to the pick's activity history.
  - The pick becomes visible to the linked Daily Shop for inclusion in customer order entry.

## Submitted → Closed

- **Triggered by:** the distributor closing the day's linked Daily Shop (see the Distributor module, pending).
- **Effects:**
  - The pick is locked from grower edits.
  - Leftover counts on each Daily Pick Product line are reconciled against the day's orders.
  - An entry is appended to the activity history.

## Edits after Submitted (allowed, propagated)

A grower **can** continue to edit a Submitted pick's line items — pallets-picked, leftovers, pickup-time, comments — from the same edit popup. The status does **not** revert to Draft; the pick stays Submitted.

Edits to pallets-picked or leftovers fire the [Out-of-Stock Propagation](../backend_flows/out_of_stock_propagation.md) database trigger, which recomputes supply-vs-demand across all growers for the day's product and updates the linked Daily Shop's out-of-stock list. This keeps the customer-facing shop view consistent with the latest grower supply without requiring any explicit "re-submit" action.

## Disallowed transitions

- **Submitted → Draft** is not exposed in any UI. There is no "un-submit" affordance.
- **Closed → anything** is not permitted. A new trading day produces a new Daily Pick; old picks remain Closed as the historical record.
- **Draft → Closed** without passing through Submitted is not exposed. The Daily Pick Bootstrap can replace a Draft pick during a rerun, but that is a _replacement_ of the record, not a status transition on the existing one.

## Test implications

- A grower must be able to edit a Submitted pick and see the change in the shop's out-of-stock list within the propagation window — this is a positive contract, not a regression edge case.
- An attempt to reverse from Submitted to Draft via any means (URL manipulation, API replay) must fail or have no effect on status.
- Once a pick is Closed, subsequent grower edit attempts on its lines must be rejected by the system, not silently accepted.
