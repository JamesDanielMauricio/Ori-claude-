---
title: "Distributor (Backoffice)"
node_type: module
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The platform's operational heart. Distributors run the trading day; Admins additionally manage user accounts, roles, and platform configuration. Both roles share a single page — `backoffice` — that tabs between eleven sub-screens covering shop control, the day's arrangement, and reference-data management.

The trading day follows a strict four-phase lifecycle. Each phase is triggered by a button on the Shop Control panel, and each phase progresses an umbrella state on App Settings. Until a phase completes, the next phase's button is hidden. After the final phase (close arrangement), the day is fully reset for the next trading day.

## Children

- Screens
  - [Backoffice](screens/backoffice/_index.md) — the single tabbed page
    - [Shop Control Panel](screens/backoffice/shop_panel.md) — the lifecycle action buttons
    - [Arrangement View](screens/backoffice/arrangement_view.md) — central dashboard of the day's picks + orders
    - [New Arrangement](screens/backoffice/new_arrangement.md) — arrangement creation/assignment wizard
    - [Order History](screens/backoffice/order_history.md) — fulfilled customer orders
    - [Reference Data Management](screens/backoffice/management_screens.md) — growers / customers / products / users / transporters
- User flows
  - [Daily Lifecycle](user_flows/daily_lifecycle.md) — the four-phase trading day
- Backend flows
  - [Initiate Business Day](backend_flows/initiate_business_day.md) — phase 1
  - [Create Daily Shop Data](backend_flows/creating_daily_shop_data.md) — shop bootstrap (idempotent)
  - [Open Shop](backend_flows/open_shop.md) — phase 2 — customer order window opens
  - [Close Shop](backend_flows/close_shop.md) — phase 3 — order window ends
  - [Close Arrangement](backend_flows/close_arrangement.md) — phase 4 — terminal step
  - [Populate Prices](backend_flows/populate_prices.md) — final price-setting on arrangement records
  - [Daily Check for Empty Orders](backend_flows/daily_check_empty_orders.md) — cron sweep cleanup
- Business rules
  - [Distributor Access Gating](business_rules/distributor_access_gating.md) — backoffice page guard
  - [Lifecycle Invariants](business_rules/lifecycle_invariants.md) — what must hold between phases

## Cross-module references

- Order Status, Shop Status, Arrangement Status state machines → [Shared State Machines](../00_shared/state_machines/).
- WhatsApp dispatch on arrangement close → [WhatsApp Messaging](../00_shared/integrations/whatsapp.md).
- Pick Status transitions touched by close_arrangement → [Pick Status Transitions](../01_grower/business_rules/pick_status_transitions.md).
- Order Status transitions touched by close_arrangement → [Order Status Transitions](../02_customer/business_rules/order_status_transitions.md).
