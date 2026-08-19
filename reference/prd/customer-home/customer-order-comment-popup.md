---
title: "Customer Order — Comment Popup"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A small popup inside the customer order form that the customer opens to enter (or revise) a per-line comment.

## Contents

- A confirmation button group (one element).

That's it — the popup is intentionally minimal. The actual comment input is bound elsewhere in the order form (likely an inline input that this popup confirms). The popup serves as a confirm/dismiss surface, not a form on its own.

## Test implications

- A customer entering a comment must round-trip through this popup's confirmation before the comment is persisted on the line.
- Tests should not expect rich UI inside this popup; it's a confirmation gate, not a form.

> [GAP] Whether the comment input is INSIDE this popup or OUTSIDE (with the popup serving as a confirm gate) needs a deeper element-tree walk in `customer_order_interface_v2`. The popup itself only owns a confirmation button group, suggesting the input lives elsewhere.
