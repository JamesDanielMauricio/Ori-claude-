---
title: "Order Status — State Machine"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A Daily Order has five defined states in the option set. **Only the first two are reached by current code** — see "Reachability" below.

| Code             | Label (he)   | Plain meaning                                                                 | Reachable?         |
| ---------------- | ------------ | ----------------------------------------------------------------------------- | ------------------ |
| Open             | פתוחה        | Order exists, customer is still editing line items                            | YES                |
| Submitted        | נשלחה למשווק | Customer has finalized; distributor sees it for arranging                     | YES                |
| Scheduled        | שובצה למשלוח | Distributor has assigned arrangement records to the order; ready for dispatch | **NO — see below** |
| Out for delivery | יצאה להפצה   | Transporter has picked up the order; in transit                               | **NO**             |
| Received         | התקבלה       | Customer / distributor confirms delivery                                      | **NO**             |

## Reachability — only two of five states are reached in the running platform — by design

**Stakeholder-confirmed (2026-05-15): the three later states are aspirational placeholders.** The option set retains them as forward-looking labels for capabilities the platform may add later, but in the current code the trading flow ends at Submitted. **Code is the anchor** — the 5-state machine is functionally a 2-state machine today, and tests must respect that.

A verification across every workflow in the platform confirms that **the status is only ever set to Open or Submitted**. Scheduled, Out for delivery, and Received are values in the option set but are never assigned by any code path.

The writers of order status are:

- The customer's order entry submit action — moves a Daily Order to **Submitted** when the customer finalizes their order. Stamps Submission Time.
- The customer's order entry on a validation failure / empty save — sets the order back to **Open**.
- The Distributor's editing-on-behalf-of-a-customer view — when the Distributor saves changes to a customer's order, it writes the order back to **Submitted**.

**Implication:** the three later states (Scheduled, Out for delivery, Received) are **vestigial / aspirational** — defined for the platform's intended future but never reached today. Any UI element that displays "Scheduled" would have to be deriving that label from another data source (e.g., the presence of arrangement records), not from the order's status field.

Tests must NOT assert any order ever reaches Scheduled or later by status-driven means. Tests CAN assert that customer-submitted orders fulfilled by the close-arrangement step still show **Submitted** at the end of the day (the actual end state in current code).

This is a real product question worth raising with stakeholders: are the three later states intended to be reachable? If yes, by which workflow / which user action? If no, the option set should be pruned to match reality.

## Allowed transitions

```
Open ──submit by customer──▶ Submitted
Submitted ──arrange by distributor──▶ Scheduled
Scheduled ──dispatch by transporter──▶ Out for delivery
Out for delivery ──confirm receipt──▶ Received
```

All transitions are forward-only. There is no "un-submit" or "un-receive" exposed in the UI.

## Triggers per transition

- **Open → Submitted**: Customer presses the submit action on the order entry form. Submission Time is stamped.
- **Submitted → Scheduled**: Distributor closes the day's arrangement (`close_arrangement` workflow) — order is now part of a closed arrangement. The arrangement plan now governs fulfillment.
- **Scheduled → Out for delivery**: A transporter action (not yet decomposed in this PRD pass — needs further Distributor module work).
- **Out for delivery → Received**: Delivery confirmation (manual or automated — needs further decomposition).

## Test implications

- Tests asserting "the customer can edit their order" must respect status. Edits to **Open** orders are normal flow; edits to **Submitted** may or may not be allowed (see Customer module's order-status-transitions rule once authored from the code).
- Status text shown to users is Hebrew — assertions on UI labels should compare to the Hebrew display string, not the English code.
