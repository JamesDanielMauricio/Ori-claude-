---
title: "Order History (Distributor view)"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The screen shown when `tab=arranged history`. Shows all customer orders from prior trading days — typically those in Scheduled / Out for delivery / Received status.

## Display

- One row per Daily Order, sorted by date (newest first).
- Filters by customer, date range, status.
- Drill-in to see line items and arrangement details.

## Privileged access

This view legitimately reads across all customer companies (no company-scope filter) — backed by the Distributor's permission in the [Order Visibility](../../../02_customer/business_rules/order_visibility.md) rule.

## Test implications

- A Distributor must see orders from every customer company for the queried date range.
- An Admin (also a privileged role) should see the same set.
- A Customer logging into this URL via direct paste should be signed out (per access gating).
