---
title: "Daily Shop Product"
node_type: entity
source: st4ck PRD (Ori and the Bananas), environment=staging
---

One record per (Daily Shop, product variety). Created when the day's shop is bootstrapped and populated by `creating_daily_shop_data_part2`. Carries the day's pricing decisions and the aggregate supply numbers.

## Fields (business meaning only)

| Field                       | Type                        | Notes                                                                                                                                |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Date                        | date                        | The trading date.                                                                                                                    |
| Linked Daily Shop           | reference → Daily Shop      | The parent shop.                                                                                                                     |
| Linked Product Variety      | reference → Product Variety | The specific variety being offered.                                                                                                  |
| Price                       | number                      | The day's per-pallet price when applicable.                                                                                          |
| Price Range From / To       | number                      | Range pricing when applicable.                                                                                                       |
| Price Type                  | option:price_types          | Which pricing model is used for this variety on this day.                                                                            |
| No. Overbooking             | number                      | Buffer accepted above pick supply for this day's variety. Distinct from the catalog's `no_overbooking` — can be overridden per shop. |
| Total Pallets Picked        | number                      | Aggregate pallets across all growers for this variety on this day.                                                                   |
| No. of Pallets per Customer | number                      | Default or maximum pallet allocation per customer (applied as a UI hint or upper bound).                                             |
| Comments                    | text                        | Free-text note on the day's offering for this variety.                                                                               |
| Deleted                     | boolean                     | Soft-delete flag.                                                                                                                    |

## Privacy

`everyone, logged in` — readable to all authenticated users (customers see prices when their company is configured to). Per-tenant filtering happens at the Daily Shop level, not on this entity directly.

## Relationships

- A Daily Shop has many Daily Shop Products (one per variety carried that day).
- A Daily Shop Product references one Product Variety from the catalog.
- The Arrangement View aggregates Daily Shop Products to show the day's full offering and total supply.

## Lifecycle

- **Create**: `creating_daily_shop_data_part2` schedules creation for each variety in the day's pooled in-season list.
- **Update**: by the Distributor via the Arrangement View or Product Management screens during the trading day.
- **Soft-delete**: when a variety is removed from the day (e.g., a grower's in-season list shrinks mid-day during rerun).

## Test implications

- Number of Daily Shop Products on a given Daily Shop should equal the count of in-season varieties across active growers for the date.
- Price + Price Type + Range fields should be readable consistently by both customer and distributor screens.
- Updates here should flow through to the arrangement view's pooled-supply column.
