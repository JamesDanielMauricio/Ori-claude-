---
title: "Place / Edit Today's Order"
node_type: user_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The customer's recurring journey. Runs whenever the customer wants to order produce for an open trading day.

## Preconditions

- The customer is logged in with the Customer role.
- The day's [Daily Shop](../../00_shared/state_machines/shop_status.md) is **Open** — otherwise no new orders can be placed for that date.
- The day's product catalog (varieties in the shop) has been populated by the distributor's lifecycle bootstrap.

## Steps

1. **Arrive on Customer Home.** Default tab is `data` (the order form). If a Daily Order for today already exists for this customer's company, the form binds to it; otherwise a new order is created on first interaction.
2. **Set pallet counts per variety.** For each product the customer wants, enter the pallet count. Zero is valid (and results in line deletion if a line existed).
3. **Add per-line comments** (optional).
4. **Each edit auto-saves** to the backend via [Save Order Line](../backend_flows/save_order_line.md). The parent order's `processing` flag flicks on during save and off after.
5. **System updates supply state.** Each pallet-count change fires the [Out-of-Stock Propagation](../backend_flows/out_of_stock_on_order_edit.md) trigger, which recomputes total supply vs total demand across all growers and customers for that variety, and adds or removes the variety from the shop's `out_of_stock_products_list`.
6. **Submit.** The customer presses submit on the order header. The parent Daily Order moves **Open → Submitted**, Submission Time stamped.
7. **Continue editing (likely).** As the shop remains Open, the customer can continue revising line items. Each revision re-triggers the propagation logic.
8. **Day's arrangement closes.** When the distributor closes the day's arrangement, the order moves into the next status (Scheduled). At this point, the customer's edit window for that day is effectively over.

## Success state

Today's Daily Order is in **Submitted** status (or later in the day, **Scheduled**). The shop's out-of-stock list accurately reflects current supply vs demand.

## Error paths

- **Wrong role mid-session** — role check signs the user out.
- **Shop closes during editing** — the customer's submit action may fail or be rejected at the workflow layer; tests should verify the failure mode (silent acceptance into a closed shop is a bug).
- **Out-of-stock variety** — a customer ordering a variety already in the shop's out-of-stock list should either be blocked or warned. The exact UX needs decomposition of the order form's element conditions.

## Edits after submit

By symmetry with the grower side (where edits to Submitted picks propagate via trigger) and based on the workflow naming (`update out of stock products to the shop (when editing orders)`), customer edits to a Submitted order also propagate. The behavior is the same: edits do not reverse the status; they re-fire the supply-vs-demand recompute.
