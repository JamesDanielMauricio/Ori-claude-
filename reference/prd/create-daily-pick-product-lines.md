---
title: "Create Daily Pick Product Lines"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Called by `creating_daily_pick_&_daily_pick_products_trigger` (Actions 6–8) for each product variety in a grower's in-season list. Creates the per-line Daily Pick Product records the grower will then edit.

## Inputs

- The grower company.
- The Daily Pick header (the parent record this line belongs to).
- The product variety being created.

## Actions (3)

1. **TerminateWorkflow (conditional stop)** — guards the workflow against duplicate creation. The exact condition needs decomposition but the pattern matches "if a line already exists for this combination, stop".
2. **NewThing → daily_inventory** — creates the **real** Daily Pick Product line. This is the row the grower edits.
3. **NewThing → daily_inventory** — creates a **temp record** (`is_temp_record = true`) Daily Pick Product line.

## Why two records per (grower, day, variety)

The workflow creates **one real line + one temp line** per variety. The temp record is used as a scratch slot for recalculations and for out-of-stock-propagation computations that should not affect the real line's history.

- The grower edits the **real** line via the inline pallet-count input.
- The **temp** line participates in cross-grower aggregation queries (for example, the out-of-stock supply formula sums real lines only — temp records are explicitly filtered out by `is_temp_record_boolean equals false` guards).
- Distributor edits-on-behalf-of-grower flows use temp records as a staging area.

The dual-record pattern is unusual and easy to misunderstand. Tests need to be careful to query the right one.

## Rerun semantics — does it preserve pallet counts?

The TerminateWorkflow guard at Action 1 is intended to prevent duplicate creation on rerun. **In practice, this means:**

- On the first run for a (grower, day, variety) combination, both records are created with pallets_picked = 0.
- On a rerun for the same combination, the workflow terminates at Action 1 — **no new records are created, and existing pallet counts are preserved**.

This resolves the open question from [Daily Pick Bootstrap](daily_pick_bootstrap.md) about rerun preservation: **previously-entered pallet counts on in-season varieties survive a rerun**.

## Test implications

- A test that creates a grower, initiates the business day, enters pallet counts, then reruns initiate, must verify pallet counts persist on the real lines.
- The temp records on every (grower, day, variety) combination should always exist alongside the real records — a count check verifies the pipeline ran correctly.
- A test that mistakenly mutates a temp record will produce surprising results — temp records do NOT propagate to supply calculations.
