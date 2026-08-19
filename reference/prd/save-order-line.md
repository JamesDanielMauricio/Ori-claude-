---
title: "Save Order Line"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

API workflow called by the customer's order form on each line edit. Uses a packed text parameter to carry multiple values in one request — necessary because the form batches edits.

## Inputs

The workflow accepts a `text` parameter containing dash-separated values:

```
<order-id> - <new-pallets> - <comment> - <line-id (optional)>
```

Plus references to the parent `daily order`, `daily shop`, `product variety`, and a `last item` flag that tells the workflow when to clear the parent order's processing lock.

## Behavior (5 actions)

1. **Update existing line.** Search for a Daily Order Product with ID matching the trailing segment. If found, update its `comment` and `no_of_pallets_new`.
2. **Create new line.** Only when step 1 found nothing (no existing line). Create a Daily Order Product with the customer's company, the product variety, the parent order, the new pallet count, and `no_of_pallets_before = no_of_pallets_new` (initial value).
3. **Delete the updated line.** Only when step 1 found a line and its new pallet count is ≤ 0 (or empty). Hard delete.
4. **Delete the created line.** Only when step 2 created a line and its new pallet count is ≤ 0 (or empty). Hard delete.
5. **Clear processing flag.** Only when the `last item` parameter matches the input — meaning this is the last line in the batch. Clears the parent Daily Order's `processing` flag.

## Why the dash-split parameter

The order form sends multiple line edits as a queue, batching them so the form doesn't fire a workflow per keystroke. Each batched call passes one line's data packed into the text parameter and a flag indicating whether this is the last in the batch.

This makes the workflow brittle to changes in field separator: **the workflow does not appear to escape dashes in comments**. A comment containing `-` will be split as if the dash were a field separator, corrupting the parse: the comment portion will be truncated and the trailing segments will be misassigned to subsequent fields (line-id, etc.).

**Expected behavior in practice:** silent data corruption on commented-with-dashes lines. The customer sees their comment saved as a fragment; the line-id segment may point at a wrong record, causing an update on an unintended line.

**Status:** this is a real product fragility, not a known bug being intentionally preserved. Worth tracking as a quality ticket.

## Privacy bypass

Runs with `Ignores Privacy: yes` — required because it operates on records the customer's authenticated session may not have direct write privilege over (the User privacy rule on Daily Order Products has Create/Modify/Delete via API set to false).

## Test implications

- A line edit must result in exactly one of: update / create / delete — never multiple. The conditional `Only when` guards make the four-action structure mutually exclusive.
- A batch of N line edits must result in the parent order's `processing` flag being cleared exactly once, on the last call.
- A comment containing `-` currently DOES corrupt the parsing (per "Why the dash-split parameter" above). Tests asserting graceful handling will fail — that's the real product behavior. Do not author a passing test against the broken behavior; file a quality ticket.
