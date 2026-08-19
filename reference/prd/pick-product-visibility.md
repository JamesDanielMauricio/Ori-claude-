---
title: "Pick Product Visibility"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A Daily Pick Product line is readable, searchable, creatable, modifiable, and deletable by **any user who is logged in**, regardless of role or company. Unauthenticated users see nothing.

## Where isolation actually happens

Company-level grower isolation is enforced **upstream** at the Daily Pick header (see [Pick Visibility](pick_visibility.md)). The application is expected to scope line-item queries through their parent pick rather than rely on a per-line privacy rule. The line-level rule is intentionally permissive because:

- Customers and Distributors must be able to read all line items to assemble orders and run the day's shop.
- The system-level [Out-of-Stock Propagation](../backend_flows/out_of_stock_propagation.md) trigger needs cross-grower read access to compute total supply.

## Test implications

- A bug that displays a Daily Pick Product without filtering through its parent pick's visibility would leak a competing grower's pallet counts. The privacy layer will not catch this — it is the application's job.
- Tests asserting grower-to-grower isolation must verify the **screen layer** (e.g., the grower home shows only the user's own picks), not the raw entity.
- Tests of cross-grower aggregation (such as the out-of-stock trigger's supply calculation) **must** pass — those queries deliberately span growers.
