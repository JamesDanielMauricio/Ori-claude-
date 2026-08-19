---
title: "Grower Interface"
node_type: module
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Surface for users with the Grower role to declare what produce they have available on a given day. A grower's Daily Pick feeds the distributor's daily shop, which drives customer orders. Grower edits remain possible after submission and propagate to the shop automatically.

## Children

- Screens
  - [Grower Home](screens/grower_home/_index.md)
    - [Header Menu](screens/grower_home/header_menu.md)
    - [Daily Pick History List](screens/grower_home/daily_list.md)
    - [Floating Sidebar](screens/grower_home/floating_sidebar.md)
- Entities
  - [Daily Pick](entities/daily_pick/_index.md) — head record (one per grower per day)
    - [Status](entities/daily_pick/status.md) — Draft / Submitted / Closed
  - [Daily Pick Product](entities/daily_pick_product/_index.md) — line items (one per product per pick)
- User flows
  - [Manage Today's Daily Pick](user_flows/submit_pick.md)
- Backend flows
  - [Daily Pick Bootstrap](backend_flows/daily_pick_bootstrap.md) — initializes a fresh pick + lines per grower per day
  - [Create Daily Pick Product Lines](backend_flows/create_pick_product_lines.md) — per-line creation invoked by bootstrap; preserves pallet counts on rerun
  - [Out-of-Stock Propagation](backend_flows/out_of_stock_propagation.md) — database trigger that mirrors grower edits to the day's shop
  - [Leftover Pipeline](backend_flows/leftover_pipeline.md) — three-workflow cascade computing end-of-day leftovers
- Business rules
  - [Pick Visibility](business_rules/pick_visibility.md) — who reads a pick (grower + Distributor)
  - [Pick Product Visibility](business_rules/pick_product_visibility.md) — open to all logged-in; isolation enforced at the header
  - [Grower Access Gating](business_rules/grower_access_gating.md) — page-level role + auth guard
  - [Pick Status Transitions](business_rules/pick_status_transitions.md) — Draft → Submitted → Closed, no reversal; edits after Submitted are allowed
