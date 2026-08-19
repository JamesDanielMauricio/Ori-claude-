---
title: "Order History"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The list-tab surface. Shows the customer's company's past Daily Orders, sorted by date (newest first).

## Per-row content

Each row displays:

- Order date.
- Order status (one of Open / Submitted / Scheduled / Out for delivery / Received).
- Possibly a summary count (number of line items / total pallets).

Tapping a row drills into the order — typically routing to `?tab=data&data=<order-id>` so the customer can view (or edit, depending on status) the order's lines.

## Filtering / scope

- Scoped to the customer's company by privacy rule + screen-level search constraint.
- A Customer from Company A never sees Company B's orders in this list (multi-tenant isolation).

## Test implications

- Cross-company isolation must hold even if a customer has Distributor-role users in their organization viewing the same screen.
- Drilling into an old order in `Received` status should NOT show edit affordances — only a read-only view (the exact mechanics need further decomposition once popups are walked).
