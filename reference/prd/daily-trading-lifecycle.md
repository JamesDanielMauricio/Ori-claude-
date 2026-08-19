---
title: "Daily Trading Lifecycle"
node_type: user_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The Distributor's core daily journey. One iteration per trading day. The cycle is **forward-only** — each phase locks the previous and there is no "rewind" UI.

## Phases

### Phase 1 — Initiate Business Day

- **Trigger**: Distributor presses "Initiate Business Day" on the Shop Control Panel.
- **Backend**: [initiate_business_day](../backend_flows/initiate_business_day.md).
- **What happens**:
  - A new Daily Arrangement record is created (status: Open).
  - **Active Grower companies that have at least one product in their in-season list** have their `default_pickup_time` updated to today. Growers with empty in-season lists are silently skipped.
  - For each eligible Grower, a `create_growers_data` job is scheduled — this is what bootstraps each grower's Daily Pick + Daily Pick Product lines.
  - App Settings: `day_status` → "open", `visible_buttons` → "awaiting".
- **State after**: The day is now "alive" but the shop is not yet open. Growers can begin editing their picks (their picks exist in Draft).

### Phase 2 — Open Shop

- **Trigger**: Distributor presses "Open Shop".
- **Backend**: [open_shop](../backend_flows/open_shop.md) (calls [creating_daily_shop_data](../backend_flows/creating_daily_shop_data.md) as a precursor or in parallel).
- **What happens**:
  - A new Daily Shop record is created.
  - For each active Customer company, a `create_customer_data` job is scheduled — this is what bootstraps each customer's Daily Order header.
  - App Settings: `shop_status` → "open", `visible_buttons` → "closed" (meaning "next action is to close").
- **State after**: Customers can now place orders. Growers can continue editing their picks.

### Phase 3 — Close Shop

- **Trigger**: Distributor presses "Close Shop".
- **Backend**: [close_shop](../backend_flows/close_shop.md).
- **What happens**:
  - Daily Shop's status → Closed.
  - App Settings: `shop_status` → "close", `visible_buttons` → "close_arrangement".
  - A Session record is created with type `close_shop`.
- **State after**: Customers can no longer place or edit orders. The Distributor now works in the Arrangement View to assign supply to demand.

### Phase 4 — Close Arrangement

- **Trigger**: Distributor presses "Close Arrangement".
- **Backend**: [close_arrangement](../backend_flows/close_arrangement.md).
- **What happens** (9 actions; the terminal lifecycle workflow):
  - A Session record is created with type `end_the_day`.
  - App Settings: every "active" reference is cleared (active shop, active arrangement, active pick list, active order list). `day_status` → "closed", `shop_status` → "close", `visible_buttons` → "open" (ready for the next day's initiate).
  - The day's Arrangement record's status → Closed.
  - **Every** Daily Pick for the date is mass-updated to status Closed (this is what locks grower picks).
  - Every Product Variety's `highlight_price_fluctuations` flag is cleared.
  - WhatsApp dispatched to customers (with their arrangement summary) and growers (with their sales summary) — gated by the WhatsApp toggles. Two batches: company-level (group ID) and user-level (individual phone).
  - The `populate prices` custom event runs to set final prices on every arrangement record.
- **State after**: The trading day is fully terminated. The next day's `initiate_business_day` produces fresh records.

## Why the four phases

Each phase corresponds to a different audience's window of action:

- Phase 1 enables growers.
- Phase 2 additionally enables customers.
- Phase 3 closes the customer window (preserving growers' continued ability to revise leftovers).
- Phase 4 finalizes the day — all parties locked, notifications sent, prices final.

The strict sequencing prevents (for example) a customer placing an order against a shop that doesn't exist yet, or a distributor closing an arrangement while orders are still being placed.

## Test implications

- A test of the full lifecycle must walk all four phases in order and assert the expected state after each. Skipping a phase is a real bug.
- The "active" cleanup in close_arrangement is comprehensive — a test must verify ALL of (active_daily_shop, active_daily_arrangement, active_daily_pick_data_list, list_of_active_daily_order_data) are emptied. Missing any one leaves a stale reference that breaks the next day.
- WhatsApp dispatch on close_arrangement is gated by two toggles — test both ON and both OFF combinations and verify message dispatch matches.
- Pressing the same lifecycle button twice in quick succession should be idempotent. The workflows do not appear to have explicit double-call guards — a real test risk worth probing.
