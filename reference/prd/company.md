---
title: "Company"
node_type: entity
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The platform's tenant unit. Names of growers, customers, distributors, and transporters are all Company records; the user-level account (User entity) is associated to a single Company.

## Key fields (business meaning only)

| Field                                          | Type                               | Notes                                                                                                                                                            |
| ---------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                                           | text                               | Display name (e.g., "ליאור הרפז שיווק").                                                                                                                         |
| Type                                           | option:Company Types               | Admin / Marketer (Distributor) / Grower / Customer / Driver (Transporter). One per company.                                                                      |
| Status                                         | option:Company Status              | Active / Inactive — see [Company Status](../state_machines/company_status.md).                                                                                   |
| Default Pickup Time                            | date                               | The hour-and-minute the grower normally has produce ready (used as a template when the daily pick is bootstrapped). Only meaningful for Grower companies.        |
| Can See Product Prices                         | boolean                            | Whether this company sees prices in arrangement notifications (WhatsApp). Only meaningful for Customer companies.                                                |
| Group ID (WhatsApp)                            | text                               | The WhatsApp group ID for company-level notifications. When set, group dispatch fires; when empty, individual-user dispatch fires instead.                       |
| Products in Season List                        | list of Product Variety references | The catalog of varieties this grower carries this season. Drives which Daily Pick Product lines are bootstrapped each day. Only meaningful for Grower companies. |
| `_grower__for_database_trigger_purpose_number` | number                             | A counter incremented by the `update_grower_daily_pick` workflow to drive database triggers. Internal mechanism — not user-visible.                              |

## Relationships

- A Company has many Users (the User entity has a `company` field linking back).
- A Grower Company is the parent of many Daily Picks (one per trading day).
- A Customer Company is the parent of many Daily Orders.
- A Company can appear on both sides of a Daily Arrangement Record (`grower` side and `customer` side).

## Multi-tenancy implication

Most visibility rules in the system reduce to "users see records linked to their company". A leak across companies — a Grower seeing another Grower's pick, a Customer seeing another Customer's order — is a critical bug. Tests asserting tenant isolation must verify the screen layer (UI doesn't show cross-company rows) **and** the data layer (API queries scoped correctly), because the `Daily Pick Product` privacy rules in particular are permissive (see [Pick Product Visibility](../../01_grower/business_rules/pick_product_visibility.md)).

## Test implications

- A test that creates a new Grower company must also populate the `products_in_season_list` before the next lifecycle bootstrap, or the grower will have no Daily Pick Product lines to edit.
- Toggling `can_see_product_prices` on a Customer company should change the next arrangement-close WhatsApp dispatch — testable end-to-end.
