---
title: "Order Form"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The customer's editing surface when `tab=data`. Shown for the current day's order.

## What the customer sees

- One row per Product Variety available on the day's shop.
- A pallet-count input per row (defaults to 0; the customer increments to indicate demand).
- A comment field per row.
- Aggregate summary at the bottom (total pallets, total cost where applicable).
- A submit action.

The product list shown comes from the day's Daily Shop — varieties that are out of stock (as indicated by the shop's `out_of_stock_products_list`) are marked visually but may still be selectable depending on overbooking rules.

## Save mechanics

The form is a **per-line save** model — each pallet-count or comment change triggers the [Save Order Line](../../backend_flows/save_order_line.md) backend workflow with a packed text parameter (`"<order-id>-<pallets>-<comment>-<line-id>"`, split by `-`). The workflow:

- Updates the existing Daily Order Product line if one exists for that variety.
- Creates a new line if none exists.
- Hard-deletes the line if the new pallet count is ≤ 0.
- Clears the parent Daily Order's `processing` flag when the last queued line has been processed.

A change to `no_of_pallets_new` on the line subsequently fires the [Out-of-Stock Propagation (Order Side)](../../backend_flows/out_of_stock_on_order_edit.md) database trigger.

## Submit

Pressing the submit action moves the parent Daily Order from **Open → Submitted** (Order Status state machine). Submission Time is stamped.

## After submit — edits remain possible (confirmed by manual testing 2026-05-15)

The customer can continue to edit the order after Submit, **up until the day's arrangement is closed by the Distributor**. The Save button has no status-based conditional state — it remains rendered and functional regardless of the parent order's status. Each edit flows through [Save Order Line](../../backend_flows/save_order_line.md) and fires the [Out-of-Stock Propagation (Order Side)](../../backend_flows/out_of_stock_on_order_edit.md) trigger to keep the day's shop in sync.

The order's status does NOT revert from Submitted back to Open during edits — only the line items mutate. See [Order Status Transitions — Edits after Submitted](../../business_rules/order_status_transitions.md).

## Test implications

- Each line edit must round-trip through the backend workflow — UI that "saves silently" without calling the workflow is a regression.
- A line edited down to 0 must result in physical row deletion, not soft-delete on this entity.
- Customer must not be able to add a line for a product variety that is not in the day's shop catalog.
