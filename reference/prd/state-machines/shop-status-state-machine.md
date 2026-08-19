---
title: "Shop Status — State Machine"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A Daily Shop is either **Open** or **Closed**:

| Code   | Plain meaning                                                                     |
| ------ | --------------------------------------------------------------------------------- |
| Open   | The day's order window is accepting customer orders.                              |
| Closed | The order window has ended. Customers can no longer place new orders for the day. |

## Transitions

- **Open**: Set when the distributor opens the day's shop via the `open_shop` workflow.
- **Closed**: Set when the distributor closes the shop via the `close_shop` workflow. The shop record's `Status` field is updated, the app-settings `shop_status` field is updated, and a Session audit record is created.

A closed shop is never re-opened — a new trading day produces a new Daily Shop record.

## What changes when the shop closes

`close_shop` makes three changes:

1. App settings: `visible_buttons` flag moves to "close_arrangement" (signalling to the UI that the next valid action is closing the arrangement).
2. Daily Shop's `Status` → Closed.
3. A Session record is appended marking who closed the shop and when.

Note that closing the shop **does not** close picks or arrangements — those are separate transitions on separate entities (see Pick Status and Arrangement Status).

## Test implications

- Customer order entry must be available when shop is Open and reject new orders when shop is Closed.
- A test that closes the shop must verify all three side effects, not just the daily_shop's own status field.
