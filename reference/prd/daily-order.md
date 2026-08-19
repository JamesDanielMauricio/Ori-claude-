---
title: "Daily Order"
node_type: entity
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The head record for a customer's day. Each customer company has exactly one Daily Order per trading day (or none if they don't order that day). The order ties together line items (Daily Order Products) and tracks status through the five-state lifecycle.

## Fields (business meaning only)

| Field                   | Type                   | Notes                                                                                                                                                                                                                                                                                               |
| ----------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date                    | date                   | The trading date this order applies to.                                                                                                                                                                                                                                                             |
| Submission Time         | date                   | Stamped when the customer transitions from Open to Submitted.                                                                                                                                                                                                                                       |
| Status                  | option:order_status    | Open / Submitted / Scheduled / Out for delivery / Received — see [Order Status](../../../00_shared/state_machines/order_status.md).                                                                                                                                                                 |
| Linked Customer Company | reference → Company    | The customer company that owns this order.                                                                                                                                                                                                                                                          |
| Linked Daily Shop       | reference → Daily Shop | The day's shop record this order is part of.                                                                                                                                                                                                                                                        |
| Comment                 | text                   | Free-text note on the order header (separate from per-line comments).                                                                                                                                                                                                                               |
| Activity History        | list of text           | Append-only audit trail of order lifecycle events.                                                                                                                                                                                                                                                  |
| Order Logs              | list of text           | Additional internal logging — possibly distinct from activity history.                                                                                                                                                                                                                              |
| Processing              | boolean                | Transient flag set while the save-order workflow is running. Drives UI loading state. Cleared by the workflow's final action.                                                                                                                                                                       |
| Processing Date         | date                   | Timestamp when the processing flag was set. Used to detect stale processing locks.                                                                                                                                                                                                                  |
| Actively Editing        | reference → User       | **Note: dead-code field.** Originally intended as a concurrent-edit lock; the corresponding UI guard does not function (the condition reads `"is" = "disabled"` which is always false). Treat as non-functional in tests; if you find UI behavior that depends on it, that is a bug, not a feature. |
| Last Editing Date       | date                   | When the order was last touched.                                                                                                                                                                                                                                                                    |

## Lifecycle

- **Create**: Implicitly by the customer interacting with the order entry form for the first time on a given day. The order starts in **Open**.
- **Edit while Open**: Each line-item edit calls the [Save Order Line](../../backend_flows/save_order_line.md) workflow.
- **Submit (Open → Submitted)**: Customer presses the submit action. The order is now visible to the Distributor for arranging.
- **Scheduled / Out for delivery / Received**: Driven by Distributor and Transporter actions later in the lifecycle.

## Privacy

A Daily Order is readable by:

- Users whose company is the order's customer company (own-tenant rule).
- Users with a privileged role (Distributor) — readable across all companies.

For full rules see [Order Visibility](../../business_rules/order_visibility.md).

## Test implications

- Tests asserting "the order is editable" must check status — Open orders are freely editable; later statuses may have different rules.
- The `actively_editing` field exists in the schema but does NOT gate edits in practice. Tests that try to lock another user out via this field will pass by accident (the guard is broken) and must not be cited as proof of correctness.
- The `processing` flag is short-lived. A test that finds an order stuck in `processing = true` after a save completed has caught a real bug.
