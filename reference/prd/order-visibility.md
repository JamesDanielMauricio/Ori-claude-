---
title: "Order Visibility"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A Daily Order is readable by:

- **The customer who owns it** — a user whose company is the order's customer company.
- **Distributors** — any user with the Distributor role, regardless of company.

Any other user (Grower, Transporter, or a Customer from a different company) cannot see the order. Searches return no row; the UI behaves as if the order does not exist.

## Why this matters

The Distributor's Backoffice arrangement view reads orders across all customer companies — that's the legitimate cross-company use case. A bug that fails the visibility check would either prevent the distributor from arranging the day's orders (operational failure) or leak orders to non-distributors (data breach). Both must be tested.

## Test implications

- A Grower trying to read another company's Daily Order must get an empty result (not a 403 error — privacy returns "row not found").
- A Distributor must successfully read orders across all customer companies for the day they are arranging.
- A second Customer (from a different company) attempting to access this Customer's order must get the same "row not found" behavior.
