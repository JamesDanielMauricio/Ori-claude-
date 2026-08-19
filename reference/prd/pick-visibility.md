---
title: "Pick Visibility"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A Daily Pick is readable by:

- **The grower who owns it** — a user whose company is the pick's grower company.
- **Distributors** — any user with the Distributor role, regardless of company.

Any other user (Customer, Transporter, or a Grower from a different company) cannot see the pick at all. Searches return no row; the UI behaves as if the pick does not exist, not as if access was denied.

## Readable attributes

When the visibility check passes, the user can read all business-meaningful fields of the pick: date, pickup time, submission time, grower company, linked daily shop, status, and activity history.

## Test implications

- A test asserting "hidden pick" must distinguish _absent from the result set_ (correct) from _visible-but-shown-as-error_ (a bug).
- A grower from Company A must never see a pick belonging to Company B, even by direct URL access.
- A Distributor must see picks from all grower companies on a given date.
