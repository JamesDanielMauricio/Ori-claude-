---
title: "Out-of-Stock Propagation"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

System-level. Runs automatically whenever a grower's pick-line numbers change. The grower never invokes this directly — it is a database trigger.

## When it fires

A change to a Daily Pick Product line, where **either** the pallets-picked count **or** the leftovers count differs from its previous value. Changes to other fields (comment, pickup time, etc.) do not fire this trigger.

## Skip condition

If the changed line is marked as a **temporary record** (`is_temp_record = true`), the trigger exits immediately and does nothing. Temp records are placeholders created during bootstrap recalculations and must not affect downstream shop state.

## Supply-vs-demand check

For every non-temp, non-deleted Daily Pick Product line on the **same date** and the **same product variety** (across **all** growers, not just the editor's company), the trigger computes:

```
total_supply = sum(pallets_picked) + sum(leftovers) + product.no_overbooking
total_demand = sum(pallets_ordered_new) across non-deleted Daily Order Products for the same date+product
```

Whether `total_supply > total_demand` decides the branch.

## Effect on the Daily Shop

The trigger updates `out_of_stock_products_list` on the **Daily Shop** that the edited line is linked to:

| Computed state                                              | What the trigger does to the shop's out-of-stock list |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| `total_supply > total_demand` (back in stock)               | **Removes** the product variety from the list         |
| `total_supply ≤ total_demand` (stockout persists or starts) | **Adds** the product variety to the list              |

The branches are mutually exclusive — exactly one of "remove" or "add" runs per trigger firing.

## Why it matters

This is the link that makes [grower edits after submission](../business_rules/pick_status_transitions.md) actually safe: a grower revising pallets down doesn't silently leave the shop showing a product as in-stock when it isn't, and revising up doesn't leave a stockout flag stuck on after supply is restored. Customer-facing order entry reads the shop's out-of-stock list — so this trigger is the consistency mechanism between grower supply and customer ordering.

## Propagation timing

Bubble's database triggers run **asynchronously** — they are scheduled, not synchronous to the originating change. There is no documented SLA. In practice, propagation is typically within a few seconds, but the platform does not guarantee a specific window.

Tests asserting the out-of-stock list update must either:

- Poll/wait with a generous timeout (10s+) before asserting.
- Use a deterministic wait helper that watches for the specific field change.
- Accept that immediate-assertion tests will flake.

## Test implications

- A grower-edit test that changes pallets-picked must assert the corresponding **out-of-stock list update on the shop** completes within an acceptable propagation window (per above — eventual, no platform SLA).
- The aggregation is across all growers for the same product — a test that only changes one grower's line in isolation may not flip the state if another grower still has supply. Tests must control the total supply across the cohort.
- A change to a temp record must NOT alter the out-of-stock list. This is testable by setting `is_temp_record = true`, mutating pallets-picked, and asserting no change to the shop.
