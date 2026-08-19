---
title: "Out-of-Stock Propagation (Order Side)"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The mirror of the grower-side out-of-stock trigger. Where the grower trigger fires on supply changes, this one fires on demand changes.

## When it fires

A change to a Daily Order Product where `no_of_pallets_new` differs from its previous value, **and** the record has a previous version (i.e., it's an update, not the first creation).

## Supply-vs-demand check

Identical formula to the grower-side trigger:

```
total_supply = sum(pallets_picked) + sum(leftovers) + product.no_overbooking
total_demand = sum(pallets_ordered_new) across non-deleted Daily Order Products for date+product
```

(Across all growers and customers for that date+variety, ignoring temp records and deletes.)

## Effect on the Daily Shop

Same effect, same mutually-exclusive branches as the grower-side trigger:

| Computed state    | Effect on shop's `out_of_stock_products_list`          |
| ----------------- | ------------------------------------------------------ |
| `supply > demand` | The product is **removed** from the out-of-stock list. |
| `supply ≤ demand` | The product is **added** to the out-of-stock list.     |

## Why two triggers, not one

The supply-vs-demand check is the same. But the _trigger condition_ differs:

- The grower trigger fires on supply changes (`pallets_picked` or `leftovers` on Daily Pick Product).
- The order trigger fires on demand changes (`no_of_pallets_new` on Daily Order Product).

Authoring two separate database triggers means each is scoped to its own entity, with its own guard against unrelated mutations. The cost is duplication of the supply-vs-demand formula — a real maintenance risk if the calculation ever changes (the two triggers would need to be updated in lockstep).

## Propagation timing

Identical to the grower-side trigger — Bubble's database triggers run asynchronously with no documented SLA. Tests should wait for the propagation rather than assert immediately. See [Out-of-Stock Propagation (Grower side)](../../01_grower/backend_flows/out_of_stock_propagation.md#propagation-timing) for details.

## Test implications

- Customer edits must mirror Grower edits in observable effect on the shop's out-of-stock list — testable by symmetric scenarios.
- If the demand formula ever changes, both triggers need to update — a single-trigger regression in one direction is a real risk.
