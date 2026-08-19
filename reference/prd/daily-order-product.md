---
title: "Daily Order Product"
node_type: entity
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A line on a customer's order. One record per (customer, day, product variety).

## Fields (business meaning only)

| Field                   | Type                        | Notes                                                                        |
| ----------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| Date                    | date                        | Trading date this line applies to.                                           |
| Order Timestamp         | date                        | When the line was created/last edited.                                       |
| Submission Time         | date                        | Stamped when the parent order is submitted.                                  |
| No. of Pallets (New)    | number                      | The currently-requested quantity. This is the field customers actively edit. |
| No. of Pallets (Before) | number                      | The quantity before the last edit — diff is what database triggers compare.  |
| No. of Pallets          | list of number              | History of edits (append-only). Used for audit.                              |
| Actual Pallets Received | number                      | Set by the Distributor / Transporter after fulfillment.                      |
| Comment                 | text                        | Free-text per-line note.                                                     |
| Linked Daily Order      | reference → Daily Order     | The parent.                                                                  |
| Linked Daily Shop       | reference → Daily Shop      | The day's shop.                                                              |
| Linked Customer Company | reference → Company         | The customer.                                                                |
| Linked Product Variety  | reference → Product Variety | The specific variety being ordered.                                          |
| Linked Product Family   | reference → Product Family  | The variety's family.                                                        |
| Deleted                 | boolean                     | Soft-delete flag. Excluded from active queries.                              |

## Privacy

Daily Order Products are readable by:

- Users whose company is the line's customer company.
- Users with privileged roles (Distributor, Admin, and one other — likely from the `_____` underscore-encoded role).

API write access is **disabled** for the User privacy rule (Create/Modify/Delete via API = false). All writes must go through the `Save Order Line` workflow, which runs with privacy bypassed.

## Database trigger

A change to `no_of_pallets_new` fires the [Out-of-Stock Propagation (Order Side)](../../backend_flows/out_of_stock_on_order_edit.md) trigger, which recomputes supply-vs-demand and updates the shop's out-of-stock list.

## Soft delete semantics

Lines with `Deleted = true` are excluded from active queries. The Save Order Line workflow physically deletes lines whose new pallet count is ≤ 0 (rather than soft-deleting). This means a customer setting a line back to zero results in the line being **hard deleted**, not retained for history.

## Test implications

- A line edit must trigger the out-of-stock recompute — test by changing pallet counts and asserting the linked shop's `out_of_stock_products_list` updates.
- A line set to 0 pallets must be hard-deleted by the save workflow — test by setting and asserting the row no longer exists.
- API writes are disabled — tests of "the customer can't bypass UI" should verify direct API write attempts fail.
