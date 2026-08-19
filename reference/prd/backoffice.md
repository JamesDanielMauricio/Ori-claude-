---
title: "Backoffice"
node_type: screen
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The page that mounts the entire Distributor and Admin work surface. Unlike Grower Home and Customer Home (which have two tabs), Backoffice has eleven — covering both daily-lifecycle operations and ongoing reference-data management.

## Access guard

Before any content renders, the screen enforces [Distributor Access Gating](../../business_rules/distributor_access_gating.md): non-authenticated users go to login; authenticated users without the Distributor or Admin role are signed out.

## Sidebar

The Backoffice page uses its own sidebar reusable (`side_bar_v2`) — **different** from the Customer/Grower sidebar. It provides navigation between the eleven sub-views and is always visible on desktop.

## Tabs

| URL param `tab`        | Sub-view                                              | Module purpose                                                                       |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `shop`                 | [Shop Control Panel](shop_panel.md)                   | The lifecycle action buttons (initiate, open, close shop, close arrangement).        |
| `growers`              | [Grower Management](management_screens.md)            | List, add, edit grower companies + their products in season.                         |
| `customers`            | [Customer Management](management_screens.md)          | List, add, edit customer companies.                                                  |
| `products`             | [Product Catalog Management](management_screens.md)   | Manage Product Families and Varieties.                                               |
| `users`                | [User Management](management_screens.md)              | List, add, edit user accounts and roles.                                             |
| `transporters`         | [Transporter Management](management_screens.md)       | Manage transporter companies.                                                        |
| `arrangement`          | [Arrangement View](arrangement_view.md)               | Central dashboard — see all picks and orders for the day, build arrangement records. |
| `new arrangement`      | [New Arrangement](new_arrangement.md)                 | Wizard / flow for creating a new arrangement record.                                 |
| `arranged history`     | [Order History](order_history.md)                     | Customer order history and fulfillment view.                                         |
| `distributor+grower`   | [Distributor as Grower View](management_screens.md)   | A shared view used when the Distributor needs to act on a grower's behalf.           |
| `distributor+customer` | [Distributor as Customer View](management_screens.md) | A shared view used when the Distributor needs to act on a customer's behalf.         |

## Edit-mode state

The page maintains a custom state `active add/edit mode` that tracks whether the user is creating, editing, or viewing within the current sub-view. A URL parameter `edit=<id>` is used to deep-link into edit mode on a specific record — when present, the page triggers the `nav` custom event to navigate into the right sub-view in edit mode.

## Test implications

- A deep-link to `?tab=growers&edit=<grower-id>` must load the Growers tab in edit mode with the named grower's data populated.
- Switching tabs via the sidebar should not lose unsaved edits — or should warn the user before losing them. The save-on-blur or explicit-save behavior needs decomposition once the per-screen reusables are walked.
