---
title: "Arrangement View"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The Distributor's working surface when `tab=arrangement`. Shows the full state of the day's trading — every grower's pick, every customer's order, and the arrangement records that connect them.

## What's shown

- **Pooled supply view** — every variety on the day's shop, with the total pallets supplied across all growers, broken down by grower.
- **Pooled demand view** — every variety, with the total pallets ordered across all customers, broken down by customer.
- **Arrangement records** — the records that pair specific grower pick lines with specific customer order lines (with quantities and prices). These are created in this view (or in [New Arrangement](new_arrangement.md)).
- **Out-of-stock indicators** — varieties where total demand exceeds total supply are visually flagged (driven by the shop's `out_of_stock_products_list` — see [Out-of-Stock Propagation](../../../01_grower/backend_flows/out_of_stock_propagation.md)).
- **Price configuration** — per-variety pricing for the day.

## Conceptual layout (ASCII sketch)

```
┌─────────────────────────────────────────────────────────────────────┐
│  DAY: 2026-05-15        STATUS: shop closed | arrangement open      │
├──────────────────────────┬──────────────────────────────────────────┤
│  POOLED SUPPLY (by       │  POOLED DEMAND (by variety)              │
│  variety)                │                                          │
│  ─────────────────────── │  ─────────────────────────────────────── │
│  ▸ Banana — Yellow  18p  │  ▸ Banana — Yellow         5p  ◯◯◯ OOS  │
│      Grower A    8p      │      Customer X      2p                  │
│      Grower B    10p     │      Customer Y      3p                  │
│  ▸ Apple — Gala     12p  │  ▸ Apple — Gala            8p           │
│      Grower B    12p     │      Customer X      4p                  │
│                          │      Customer Z      4p                  │
├──────────────────────────┴──────────────────────────────────────────┤
│  ARRANGEMENT RECORDS (matchmaking — grower-line × customer-line)    │
│  ─────────────────────────────────────────────────────────────────  │
│  Banana — Yellow │ Grower A   → Customer X │  2p │ ₪price            │
│  Banana — Yellow │ Grower B   → Customer Y │  3p │ ₪price            │
│  Apple — Gala    │ Grower B   → Customer X │  4p │ ₪price            │
│  Apple — Gala    │ Grower B   → Customer Z │  4p │ ₪price            │
├─────────────────────────────────────────────────────────────────────┤
│  [+ New Arrangement]   [Edit prices]   [Close Arrangement →]        │
└─────────────────────────────────────────────────────────────────────┘
```

Out-of-stock indicators (◯◯◯ OOS) flag varieties where total demand exceeds total supply (after overbooking). The supply/demand columns are side-by-side so the distributor can visually match. Arrangement records appear below as the explicit matchmaking — each row pairs one grower's line with one customer's line and a quantity.

The Close Arrangement button (Phase 4 of the lifecycle) is the terminal action; pressing it locks the arrangement and dispatches WhatsApp notifications.

> Note: this is a conceptual layout. The exact rendering (column widths, exact label text, button placements) needs decomposition of the `Arrangement view v2 A.md` element tree.

## Distributor actions on this view

- Create / edit / delete arrangement records.
- Adjust per-grower allocations.
- Set price types per variety.
- Trigger the `populate prices` workflow.

## Why this matters

The Arrangement View is the operational heart of the platform. Bugs here directly cause:

- Customers ordering produce that won't be delivered (over-allocation).
- Growers' supply being wasted (under-allocation).
- Wrong prices on close — both in WhatsApp messages and in the customer-facing record.

## Test implications

- Cross-grower aggregation must be correct: a test that creates picks from three growers must show the correct total in the supply view.
- Out-of-stock indicators must update live (or on refresh) when picks/orders change.
- Arrangement records created here are the input to [Close Arrangement](../../backend_flows/close_arrangement.md) — tests of the close flow must populate this view first.
