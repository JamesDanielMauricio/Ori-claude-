---
title: "Pick Status — State Machine"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A Daily Pick is in one of three states:

| Code      | Label (he) | Plain meaning                                                                    |
| --------- | ---------- | -------------------------------------------------------------------------------- |
| Draft     | טיוטה      | Grower is still editing. Not visible in the distributor's shop.                  |
| Submitted | נשלח       | Grower has submitted. Visible to distributor and to customer orders.             |
| Closed    | נסגר       | Linked arrangement has been closed by the distributor. Locked historical record. |

## Transitions

- **Draft → Submitted**: Grower submits via the day's edit popup. Submission Time is stamped, activity history is appended.
- **Submitted → Closed**: Distributor closes the day's arrangement (`close_arrangement`, action 5: ChangeListOfThings on daily_pick).

No backward transitions exist in any UI. **Note on the data layer:** Bubble's backend workflows can call `ChangeListOfThings` to set any status value, and many of those workflows run with `Ignores Privacy: yes`. There is no database-level constraint preventing a workflow from setting status to a "previous" value. The forward-only contract is enforced **by the absence of UI affordances and by the discipline of the workflow authors**, not by data-layer guards. Tests that probe reverse transitions via direct database manipulation should expect those manipulations to succeed — they would not be blocked.

## Why this lives in shared

Both the Grower module (which owns the user flow that creates the Submitted state) and the Distributor module (which owns the action that creates the Closed state) need to reference this state machine. Authoring it once here keeps the two modules consistent — each cross-links to this node.

For the full transition mechanics (preconditions, side effects on Daily Pick Product lines, the out-of-stock propagation that follows edits), see [Pick Status Transitions](../../01_grower/business_rules/pick_status_transitions.md) in the Grower module.
