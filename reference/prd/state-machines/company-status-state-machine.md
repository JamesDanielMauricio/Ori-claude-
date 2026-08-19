---
title: "Company Status — State Machine"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A Company is either **Active** or **Inactive**:

| Code     | Label (he) | Plain meaning                                                                                         |
| -------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| Active   | פעיל       | Participates in the trading cycle; included in day bootstraps, shop windows, and WhatsApp dispatches. |
| Inactive | לא פעיל    | Excluded from new trading day operations. Existing historical records remain.                         |

## Where the flag matters

- The `update_grower_daily_pick` workflow filters by `status = active` when iterating grower companies for pickup-time updates.
- The customer-data and grower-data bootstraps similarly skip non-active companies.
- The Backoffice grower / customer / transporter management screens can toggle this flag.

## Transitions

- An Admin or Distributor changes the flag from the Backoffice screens. There is no automated transition.
- Inactivating a company does **not** retroactively touch its prior picks, orders, or arrangement records — those persist as history.

## Test implications

- A test that creates a new company and immediately runs the daily lifecycle must ensure the company is Active, or the new company will be silently skipped by the bootstrap workflows.
