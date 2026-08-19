---
title: "Reference Data Management Screens"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Five sub-screens of Backoffice that share a common shape:

| Tab            | Manages                                          | Reusable                          |
| -------------- | ------------------------------------------------ | --------------------------------- |
| `growers`      | Grower companies + their products-in-season list | `grower_screen (backoffice)`      |
| `customers`    | Customer companies                               | `customer_screen (backoffice)`    |
| `products`     | Product Families and Varieties                   | `product_screen (backoffice)`     |
| `users`        | User accounts and role assignments               | `user_screen (backoffice)`        |
| `transporters` | Transporter companies                            | `transporter_screen (backoffice)` |

## Common shape

Each screen is a list-detail UI: a sortable list of records on one side, an editable detail panel on the other. Each screen has its own dedicated "delete, edit, discard & save" reusable that provides the action bar — a five-button pattern (delete, edit-toggle, discard changes, save changes, possibly an extra action like "duplicate" or "set status").

The pattern is repeated across all five screens because Bubble does not naturally support cross-entity reuse of these complex action bars — each one is bound to its entity's specific fields.

## Role differences — there are none, by design

**Stakeholder-confirmed (2026-05-15): Admin and Distributor are interchangeable on the Backoffice surface.** Code is the anchor; the design currently has no separation between the two roles, and that is the intended product state today.

Verified by reading all six `delete, edit, discard & save` reusables: none exposes a role parameter or a role-conditional state. Their parameters are domain-specific (company name, fields, etc.) and the only exposed state is an `edit?` boolean. The Condition workflows in each reusable react to element states (view vs edit mode), not to the actor's role.

The Backoffice page gates the whole surface to **Distributor OR Admin** at the access guard. Once inside the page, **the two roles have identical permissions** on every management screen:

| Screen       | Admin           | Distributor     |
| ------------ | --------------- | --------------- |
| Growers      | Full read/write | Full read/write |
| Customers    | Full read/write | Full read/write |
| Products     | Full read/write | Full read/write |
| Users        | Full read/write | Full read/write |
| Transporters | Full read/write | Full read/write |

The Delete / Edit / Discard / Save action buttons appear or hide based on an `edit?` state toggle — not on role. That toggle behaves identically for Admin and Distributor.

If a future need to separate Admin from Distributor arises, it is a new feature ask — not a regression against the current PRD. Tests against the current platform must NOT assume Admin can do something Distributor cannot, or vice versa, in any of the six management screens.

## Bulk operations

- **Grower creation**: invokes [create_growers_data](../../backend_flows/initiate_business_day.md) downstream (via the lifecycle's grower bootstrap).
- **Customer creation**: invokes `create_customer_data` (called by `open_shop`).
- **Product creation**: invokes `create_product_library_data`.

These bulk-create workflows produce the per-record data that the lifecycle later mutates.

## Transactional contract — there is none

The save/edit/delete workflows in each management reusable are **NOT transactional**. A typical save chain looks like:

```
1. HideElement → Group loading
2. ShowElement → Button save
3. ToggleElement → Popup
4. ChangeListOfThings (or several ChangeThing actions in sequence)
5. ChangeThing on the parent record
```

If the workflow fails between Actions 4 and 5, the database is left in a partial state — some line items updated, the parent record not. There is no rollback action and no transactional boundary.

**Implications:**

- A test that simulates mid-save failure will find inconsistent state. That's the real product behavior.
- Operators investigating "I saved but only some fields stuck" reports should look for workflow failures in Bubble's logs — the workflow may have terminated partway.
- Hardening this would require either wrapping the save in a single ChangeListOfThings (atomic per Bubble's runtime) or adding compensating actions for each field group.

This is a known fragility of Bubble's workflow model when actions span multiple data types in sequence. Not unique to this platform.

## Test implications

- Each management screen must enforce the same access guards as the parent page (Distributor or Admin only).
- Save / Discard / Delete must be transactional — partial saves that leave the entity in an inconsistent state are bugs.
- A test that creates a new Grower and adds varieties to its `products_in_season_list` must result in those varieties appearing in the next daily pick bootstrap.

## Decomposition opportunity

Each of the five screens deserves its own decomposed PRD node once the dedicated reusable elements are walked. The current node is a flat overview suitable for non-technical stakeholders and for a first-pass test plan; QA depth on individual screens requires per-screen decomposition.
