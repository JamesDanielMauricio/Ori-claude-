---
title: "Manage Today's Daily Pick"
node_type: user_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The grower's recurring daily journey. Runs whenever a grower needs to declare or revise their pallet availability for a trading day.

## Preconditions

- The grower is logged in with the Grower role (see [Grower Access Gating](../business_rules/grower_access_gating.md)).
- Today's Daily Pick already exists in **Draft**, with one Daily Pick Product line per in-season product the grower carries. These are pre-created by the [Daily Pick Bootstrap](../backend_flows/daily_pick_bootstrap.md) when the trading day is initiated by the distributor — the grower never creates the pick from scratch.

## Steps

1. **Land on Grower Home.** The Daily Pick History List shows the grower's past picks newest-first; today's Draft pick is at the top.
2. **Open today's pick.** The grower presses one of the row's action buttons to open the edit popup scoped to that pick.
3. **Edit line items in the popup.** For each product line, the grower sets:
   - **Pallets picked** — how many pallets of this variety are available today.
   - **Pickup time** — when this variety is ready to be collected (may differ per line).
   - **Comment** — optional free text.
     Zero pallets is valid (the grower has nothing of that variety today).
4. **Submit the popup.** This persists the line-level changes and transitions the parent Daily Pick from Draft → Submitted, stamping Submission Time. See [Pick Status Transitions](../business_rules/pick_status_transitions.md).
5. **Re-edit at will.** After submission, the grower can re-open the same pick from the history list and revise pallet counts or pickup times. The pick remains in **Submitted** status — there is no "un-submit" — but the edited line items are propagated downstream:
   - Each edit to **pallets picked** or **leftovers** on a line fires the [Out-of-Stock Propagation](../backend_flows/out_of_stock_propagation.md) trigger, which adds or removes the product from the linked Daily Shop's out-of-stock list based on whether supply now covers demand.
6. **Day closes.** When the distributor closes the day's shop, the linked Daily Pick is locked: status moves to **Closed** and further edits are no longer accepted from the grower UI.

## Success state

- Today's pick is **Submitted** (or **Closed** after the shop closes).
- The shop's out-of-stock list reflects the latest pallet/leftover changes the grower made.

## Concurrency

Multiple growers editing different picks for the same date never conflict — each Daily Pick is scoped to one grower company, and the Out-of-Stock Propagation trigger aggregates across all growers when it computes available supply.

## Error paths

- **Wrong role mid-session** — if the user's role changes (e.g., admin demotes them) during the session, the page's access guard signs them out on the next render. Unsaved popup state is lost.
- **Daily Pick was not pre-created for today** — if the grower lands on Grower Home and no Draft pick exists for today, the day was not initiated by the distributor. The grower cannot create one from this UI. **In practice this is an edge case** — the platform is a private business-specific app where the grower's company maintains direct (WhatsApp / phone) contact with the distributor, and a missing-day-initiation gets resolved informally on the spot. No formal in-product remediation, no SLA: this is accepted operational behavior, not a gap. The list will show prior picks but no today row.
