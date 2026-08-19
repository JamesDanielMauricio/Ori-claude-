---
title: "Customer Home"
node_type: screen
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The screen a Customer lands on after login. Like Grower Home, it has two display modes selected by a URL `tab` parameter:

- **Data tab** (`tab=data`) — the active order entry / management surface. Customers edit today's Daily Order Products here.
- **List tab** (`tab=list`) — the customer's historical orders, sorted by date.

If the tab parameter is missing on arrival, the screen self-redirects to the default tab.

## Access guard

Before any content renders, the screen enforces [Customer Access Gating](../../business_rules/customer_access_gating.md): non-authenticated users go to login; authenticated users without the Customer role are signed out and redirected to login.

## Components

The screen mounts:

- [Header Menu](../../../00_shared/components/header_menu/_index.md) — shared with Grower Home; provides identity strip + hamburger navigation.
- [Sidebar — Customer/Grower](../../../00_shared/components/sidebar/_index.md) — shared sidebar; on this page renders the Customer label variants ("הזמנה [date]" for the primary action, "הסטורית הזמנות" for the history link).
- [Order Form](order_form.md) — the data-tab surface where the customer edits today's order.
- [Order History](order_history.md) — the list-tab surface showing past orders.

## Data context

The screen carries four pieces of data sourced at load time:

- The customer's current-day Daily Order (matched by today's date + the user's company).
- The Daily Order identified by the `data` URL parameter, when present.
- The global App Settings record.
- The active tab parameter.

## Test implications

- The header and sidebar must visually match Grower Home (same shape, swapped labels) — visual regression tests should validate this.
- A direct deep-link to `?tab=data&data=<order-id>` must load the specific order and display the edit form bound to it.
