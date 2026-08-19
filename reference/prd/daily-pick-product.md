---
title: "Daily Pick Product"
node_type: entity
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A line on a Daily Pick. One record per (grower, day, product variety). Many Daily Pick Products belong to one Daily Pick.

## Fields (business meaning only)

| Field                          | Type                          | Notes                                                                         |
| ------------------------------ | ----------------------------- | ----------------------------------------------------------------------------- |
| Date                           | date                          | Trading date this line applies to (mirrors the parent pick's date).           |
| Pickup Time                    | date                          | When this specific product can be picked up. May differ from the pick header. |
| Pallets Picked                 | number                        | How many pallets the grower has available for this product on this date.      |
| Leftovers                      | number                        | Pallets remaining unsold at end of day (set by the close arrangement step).   |
| Leftover Pallets After Day End | number                        | Final leftover count after the day's closing reconciliation.                  |
| Comment                        | text                          | Free-text grower note about this line.                                        |
| Linked Daily Pick              | reference → Daily Pick        | The header pick this line belongs to.                                         |
| Linked Daily Shop              | reference → Daily Shop        | The distributor shop window this line feeds.                                  |
| Linked Grower Company          | reference → Company           | The grower company.                                                           |
| Linked Product Variety         | reference → Product Variety   | The specific variety (e.g., "Yellow Banana").                                 |
| Linked Product Family          | reference → Product Family    | The family the variety rolls up to (e.g., "Bananas").                         |
| Linked Arrangement Record      | reference → Daily Arrangement | The arrangement plan this line was assigned to during shop close.             |
| Is Temp Record                 | boolean                       | Marks a placeholder line created during a recalculation/rerun pass.           |
| Deleted                        | boolean                       | Soft-delete flag — lines with this set are excluded from the active grid.     |

## Relationships

- Belongs to **one** Daily Pick (parent).
- Tied to **one** Daily Shop (the day's distributor window).
- References **one** Product Variety and its rolled-up Product Family.
- After arrangement close, references **one** Daily Arrangement record.

## Soft-delete behavior

Lines are never hard-deleted from the grower flow — they are flagged with `Deleted = true` and excluded from active views. This preserves the activity history and the relationship to a closed shop.
