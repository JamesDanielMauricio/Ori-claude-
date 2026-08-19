---
title: "Order Status Transitions"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The Order Status state machine has five states (see [Order Status](../../00_shared/state_machines/order_status.md)). This document fleshes out the mechanics behind each transition: who triggers it, what fires, and what the customer experiences.

## Open → Submitted

- **Triggered by:** the customer pressing the submit action on the order entry form.
- **Side effects:**
  - Order's Submission Time stamped.
  - Activity History appended.
  - Order is now visible to Distributors as a candidate for arrangement.

## Submitted → Scheduled — does not happen in current code (aspirational)

**Stakeholder-confirmed (2026-05-15):** the three later states are aspirational placeholders. **Code is the anchor.** No workflow advances a Daily Order from Submitted to Scheduled. The close-arrangement workflow that ends the trading day does not change order status. The Distributor editing a customer's order writes the order back to Submitted, not Scheduled. Customer orders stay in **Submitted** through the trading day's end and beyond — that is the actual product behavior, not a bug.

UI elements that display "Scheduled / Out for delivery / Received" labels would have to be deriving those labels from arrangement-record existence or another data source, not from the order's status field.

**Observable side effects of the close-arrangement step** (which fires at end-of-day but does NOT advance order status):

- WhatsApp dispatched to customers with arrangements > 0 pallets.
- Daily Picks (not Daily Orders) are locked.
- The trading day is over from the customer's editing perspective.

## Scheduled → Out for delivery — aspirational, unreachable in code

Out for delivery is defined in the option set but never assigned by any code path. Same stakeholder confirmation: aspirational placeholder.

## Out for delivery → Received — aspirational, unreachable in code

Received is defined in the option set but never assigned by any code path. Same stakeholder confirmation: aspirational placeholder.

## Edits while Open

Each line edit goes through [Save Order Line](../backend_flows/save_order_line.md). The order itself does not change status; only line items are mutated. The `processing` flag on the order flips on/off during each save.

## Edits after Submitted (allowed — confirmed by manual testing 2026-05-15)

**Stakeholder-confirmed:** a customer can continue to edit a Submitted order until the day's arrangement is closed by the Distributor. Edits propagate via the [Out-of-Stock Propagation (Order Side)](../backend_flows/out_of_stock_on_order_edit.md) database trigger. The order's status does NOT revert to Open — edits don't transition status backward; they just mutate the line items.

The Save button in `customer_order_interface_v2/Popup comment/Group confirmation button/` has no status-based conditional state. The button is rendered unconditionally; edits flow through `save_order_line` regardless of the parent order's status (Open or Submitted).

> Earlier QA reports (test I1 / dev_task f1555c6b "Gap 2") suggested the edit surface goes read-only at Submitted. **This was a misinterpretation of the test signals — manual testing 2026-05-15 confirms edits remain possible** until the day's arrangement closes. The PRD's original claim stands.

## Disallowed transitions

- **Submitted → Open** (un-submit) is not exposed.
- **Scheduled / Out for delivery / Received → any earlier state** is not exposed.
- **Open directly to anything other than Submitted** is not exposed.

## Test implications

- Tests must assert forward-only transitions. An attempt to reverse status must fail or have no effect.
- Tests of the close-arrangement workflow must verify Submitted orders **remain Submitted** at end-of-day — `close_arrangement` does not modify order status, so an order should NOT change status as a side effect of the lifecycle terminating.

### Guard against pinning dead statuses

The Order Status option set has 5 values, but only **2 are reachable** in the running platform: **Open** (פתוחה) and **Submitted** (נשלחה למשווק). Tests authored against this entity:

- **MUST anchor on the 2 active statuses only**.
- **MUST NOT assert** any order ever reaches Scheduled (שובצה למשלוח) / Out for delivery (יצאה להפצה) / Received (התקבלה) via state-driven means. Such assertions will either fail permanently or pin dead intent.
- If a test needs to express "the day's arrangement is finalized for this order", derive that from the existence of Daily Arrangement Records, not from the order's status field — no status value conveys this today.

This guard exists because the 5-value option set tempts test authors to write transitions for all of them. Don't.
