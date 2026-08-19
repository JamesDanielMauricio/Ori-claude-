---
title: "Daily Pick"
node_type: entity
source: st4ck PRD (Ori and the Bananas), environment=staging
---

One record per grower per day, describing the produce that grower has available. A Daily Pick belongs to exactly one grower company and is linked to a single Daily Shop (the distributor's open trading window for that date).

## Fields (business meaning only)

| Field                      | Type                   | Notes                                              |
| -------------------------- | ---------------------- | -------------------------------------------------- |
| Date                       | date                   | The trading date the pick applies to.              |
| Pickup Time                | date                   | When the produce can be picked up from the grower. |
| Submission Time            | date                   | Set when the grower submits the pick from Draft.   |
| Linked to Company (Grower) | reference → Company    | The grower company that owns this pick.            |
| Linked to Daily Shop       | reference → Daily Shop | The distributor shop window this pick feeds.       |
| [Status](status.md)        | option set             | Draft → Submitted → Closed.                        |
| Activity History           | list of text           | Append-only audit trail of pick lifecycle events.  |

## Privacy

Visibility is governed by [Pick Visibility](../../business_rules/pick_visibility.md): a grower sees only their own picks; one privileged role (per the Bubble export, an Allowed-Users rule) sees all.

## Lifecycle

- A new Daily Pick is created in **Draft**.
- When the grower submits, status moves to **Submitted** and Submission Time is recorded.
- When the linked Daily Shop closes, status moves to **Closed**.
