---
title: "Leftover Pipeline"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Three closely-related workflows that together handle the end-of-day leftover computation. The naming is confusingly similar; their roles are distinct.

## `update left overs` (with space) — the trigger

- **Type:** Database trigger on Daily Pick.
- **Fires when:** the pick's status changes to **Closed** (specifically the value `daily_inventory_status:____0`, set by close_arrangement Action 5).
- **Action:** schedules `update_leftovers` (no space, underscore) for the just-closed pick.

This workflow is the **bridge** between `close_arrangement`'s mass-status update and the per-pick leftover computation. It listens for pick closures and dispatches the actual computation.

## `update_leftovers` (no space, underscore) — the computation

- **Type:** API workflow.
- **Action:** `ChangeListOfThings` over the date+company's Daily Pick Product lines, populating each line's leftover number.

This is where the actual leftover calculation runs. The formula is encoded in the action's field changes (typically `pallets_picked - pallets_arranged`, by the time the trigger fires).

## `update leftover data` (with space) — the post-update trigger

- **Type:** Database trigger on Daily Pick Product (`daily_inventory`).
- **Fires when:** `the_number_of_leftover_pallets_after_the_day_ended` changes from its previous value AND the line is not a temp record.
- **Action:** ChangeThing — updates a related field (likely the Daily Shop Product's totals or the company's running leftover stats).

This trigger propagates the leftover number to downstream aggregate fields after `update_leftovers` writes the value.

## Why three workflows for one job

Each handles a different layer of the cascade:

- `update left overs` watches **pick status** (head record).
- `update_leftovers` does the **per-line computation** (line records).
- `update leftover data` watches **per-line field changes** to propagate aggregates.

The three together form an event-driven pipeline: close arrangement → pick closes → per-line leftovers computed → aggregates updated. None of them is callable from the UI directly; the pipeline is entirely system-driven.

## Naming confusion is a real risk

Three workflows with near-identical names (`update left overs`, `update leftovers`, `update_leftovers`, `update leftover data`) is a maintenance hazard. A future change intended for one is easy to apply to the wrong one. Worth a rename pass.

## Test implications

- A test of the close-arrangement flow must verify the leftover cascade fires:
  - Every closed pick's lines should have their `leftovers` field populated within a propagation window.
  - The `the_number_of_leftover_pallets_after_the_day_ended` field should match the computed value.
- Temp records (`is_temp_record = true`) must NOT trigger the post-update aggregate cascade — verify by ensuring temp records don't appear in downstream totals.
- The propagation window matches the [Out-of-Stock Propagation](out_of_stock_propagation.md#propagation-timing) timing — eventual, no documented SLA.
