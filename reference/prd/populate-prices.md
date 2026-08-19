---
title: "Populate Prices"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Custom event called as the final step of `close_arrangement` (Action 9). Sets the day's final price on every arrangement record.

## Input

- `arrangement records` — a list of Daily Arrangement records (typically those linked to the day's arrangement that was just closed).

## Action (1)

`ChangeListOfThings → type:daily_arrangement` — updates each arrangement record's price-bearing fields. The exact formula is encoded in the action's field-change expression (typically pulling from the linked Product Variety's price + Price Type + Range).

## Why this is separate from `close_arrangement` directly

`close_arrangement` already does seven things in Action 2 alone; this final pricing step is decoupled as a custom event because:

- It runs on a list-of-things, which is its own action shape.
- It can be re-run independently (e.g., during a price-recalculation pass without re-triggering the rest of close_arrangement).

## Test implications

- A test of the close-arrangement flow must verify final prices end up populated on every arrangement record for the day.
- A test that mocks or skips this step (e.g., disabling the custom event) must verify the rest of close_arrangement still completes — the final pricing is the last action and shouldn't be a dependency of earlier actions.
