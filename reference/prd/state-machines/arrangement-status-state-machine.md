---
title: "Arrangement Status — State Machine"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A Daily Arrangement is either **Open** or **Closed**:

| Code   | Plain meaning                                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Open   | The distributor is still drafting the day's arrangement plan (matching grower picks to customer orders). Default state on creation. |
| Closed | The arrangement is final. Picks are locked, prices are populated, WhatsApp notifications go out.                                    |

## Transition

- **Open → Closed**: Triggered by the distributor's `close_arrangement` workflow.

There is no reverse transition. Closing an arrangement is the terminal step of the daily trading cycle — see [Daily Lifecycle](../../03_distributor/user_flows/daily_lifecycle.md).

## Side effects when an arrangement closes

`close_arrangement` performs nine actions, of which the most consequential are:

- The arrangement's `Status` → Closed.
- Every Daily Pick for the date is mass-updated to status **Closed** (see [Pick Status](pick_status.md)).
- App settings are reset: active pick list, active arrangement, active shop, active order list all cleared; day status set to "closed"; shop status set to "close".
- Daily Arrangement Record price-highlight flags are cleared.
- WhatsApp messages are dispatched to customers and growers with arrangements > 0 pallets (gated by the WhatsApp toggle).
- Prices on Daily Arrangement Records are populated (a separate workflow handles this).

## Test implications

- A test of the close-arrangement flow must verify the cascade: arrangement closed, picks closed, app settings reset, WhatsApp dispatched (when toggle is on).
- The trading day is genuinely over once arrangement is Closed — subsequent UI operations on that day's records should be read-only.
