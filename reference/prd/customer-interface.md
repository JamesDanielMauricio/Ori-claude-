---
title: "Customer Interface"
node_type: module
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Surface for users with the Customer role to place orders for produce on a given trading day. The customer's order references specific Product Varieties and pallet counts. While the shop is open, the customer can edit their order freely; once the day's arrangement closes, their order moves into scheduled-fulfillment state.

A customer's order is read against the day's pooled supply (all growers' Daily Picks for that date). Out-of-stock state on the shop is maintained automatically by the system as both grower picks and customer orders change.

## Children

- Screens
  - [Customer Home](screens/customer_home/_index.md)
    - [Order Form](screens/customer_home/order_form.md)
    - [Order History](screens/customer_home/order_history.md)
    - [Comment Popup](screens/customer_home/comment_popup.md)
- Entities
  - [Daily Order](entities/daily_order/_index.md) — head record (one per customer per day)
  - [Daily Order Product](entities/daily_order_product/_index.md) — line items (one per product variety on the order)
- User flows
  - [Place / Edit Today's Order](user_flows/place_order.md)
- Backend flows
  - [Save Order Line](backend_flows/save_order_line.md) — the create/update/delete workflow called per line edit
  - [Out-of-Stock Propagation (Order Side)](backend_flows/out_of_stock_on_order_edit.md) — database trigger; mirrors customer demand changes to the shop's out-of-stock list
  - [Delete Empty Order Lines](backend_flows/delete_empty_order.md) — cleanup of zero-pallet lines
- Business rules
  - [Customer Access Gating](business_rules/customer_access_gating.md) — page-level role + auth guard
  - [Order Visibility](business_rules/order_visibility.md) — who reads an order (own-company + privileged roles)
  - [Order Status Transitions](business_rules/order_status_transitions.md) — the 5-state lifecycle

## Cross-module references

- The header menu, sidebar, and page data-popup shell are shared with the Grower module — see [Shared Components](../00_shared/components/).
- The Order Status state machine is shared — see [Order Status](../00_shared/state_machines/order_status.md).
- The WhatsApp notifications that fire on arrangement close target customers (see [WhatsApp Messaging](../00_shared/integrations/whatsapp.md)).
