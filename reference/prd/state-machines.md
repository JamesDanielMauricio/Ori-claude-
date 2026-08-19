---
title: "State Machines"
node_type: section
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The platform's behavior is largely a composition of small state machines: an order moves through five states, a shop through two, an arrangement through two, a pick through three. Each lives in its own file:

- [Order Status](order_status.md) — 5 states (Open → Submitted → Scheduled → Out for delivery → Received).
- [Shop Status](shop_status.md) — 2 states (Open / Closed).
- [Arrangement Status](arrangement_status.md) — 2 states (Open / Closed); the terminal step of the trading day.
- [Pick Status](pick_status.md) — 3 states (Draft / Submitted / Closed); canonical reference, mechanics in Grower module.
- [Company Status](company_status.md) — 2 states (Active / Inactive); gates participation in the trading cycle.
- [Day Status](day_status.md) — umbrella flag on app settings, drives the Backoffice action buttons.

## How tests use these

For any test that asserts "the system is in state X after action Y", the relevant state-machine node is the contract. Tests should:

1. Verify the entity's status field matches the expected code.
2. Verify any documented side effects (e.g., timestamps stamped, audit records created, downstream lists updated).
3. NOT verify behavior the state machine forbids (e.g., a reverse transition succeeding) — those tests assert specific bugs.
