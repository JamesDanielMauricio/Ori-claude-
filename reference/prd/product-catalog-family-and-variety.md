---
title: "Product Catalog — Family and Variety"
node_type: entity
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Every produce item the platform handles is represented by a **Product Variety** record. Varieties roll up into a parent **Product Family**.

## Product Family (`product_library`)

The high-level category. Examples (Hebrew): "בננות" (Bananas), "תפוחים" (Apples). One Family has many Varieties.

| Field    | Type                      | Notes                                                   |
| -------- | ------------------------- | ------------------------------------------------------- |
| Name     | text                      | The Family display name (in Hebrew).                    |
| Category | option:Product Categories | Higher-level grouping (e.g., fruit / vegetable / herb). |
| Image    | image                     | Catalog-page imagery.                                   |

## Product Variety (`produce`)

A specific sellable item within a family. Carries the specifics that matter for pricing and packing.

| Field                        | Type                       | Notes                                                                                                                                                          |
| ---------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variety                      | text                       | The variety name within the family (e.g., "Yellow"). Combined with Family name gives "Banana — Yellow".                                                        |
| Linked Family                | reference → Product Family | The parent.                                                                                                                                                    |
| Sizes                        | text                       | Free-text size descriptor.                                                                                                                                     |
| Pack Type                    | option:Pack Types          | Pallets or Crates.                                                                                                                                             |
| Price (number)               | number                     | Single-value price when applicable.                                                                                                                            |
| Price Range From / To        | number                     | Range pricing when applicable.                                                                                                                                 |
| Price Type                   | option:Price Types         | The pricing model (Record, Record + 1, Range, Number, etc. — about a dozen values).                                                                            |
| No Overbooking               | number                     | Buffer accepted above pick supply when computing demand vs supply (see [Out-of-Stock Propagation](../../01_grower/backend_flows/out_of_stock_propagation.md)). |
| Highlight Price Fluctuations | boolean                    | A flag the close-arrangement workflow resets. UI signal for distributors.                                                                                      |

## Catalog vs Daily Records

The Catalog is the _master_ list — the universe of what could be sold. Daily Pick Products and Daily Order Products reference into the catalog by variety. A grower's `products_in_season_list` on their Company record selects a subset of the catalog they currently carry.

## Test implications

- Adding a new Variety to a Grower's in-season list should result in a new Daily Pick Product line on the next bootstrap.
- Changing a Variety's price during the day should not affect already-closed records (the daily records carry the price at the time the line was created — historical immutability).
