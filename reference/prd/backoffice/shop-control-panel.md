---
title: "Shop Control Panel"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The screen shown when `tab=shop`. The Distributor's primary action surface for the trading day.

## Buttons (gated by app_settings.visible_buttons)

The `visible_buttons` flag on App Settings drives which button is shown:

| App-settings state                        | Visible button            | Triggers                                                              |
| ----------------------------------------- | ------------------------- | --------------------------------------------------------------------- |
| `open` (initial / post-close-arrangement) | **Initiate Business Day** | [initiate_business_day](../../backend_flows/initiate_business_day.md) |
| `awaiting` (post-initiate)                | **Open Shop**             | [open_shop](../../backend_flows/open_shop.md)                         |
| `closed` (post-open-shop)                 | **Close Shop**            | [close_shop](../../backend_flows/close_shop.md)                       |
| `close_arrangement` (post-close-shop)     | **Close Arrangement**     | [close_arrangement](../../backend_flows/close_arrangement.md)         |

Note the slightly confusing semantics: the `closed` value of `visible_buttons` indicates "the shop is open and the next action is to close it" — it doesn't mean the shop is closed.

## Other panel content

In addition to the four lifecycle buttons, the panel likely displays:

- Current day status summary (which phase we're in).
- Day's current arrangement / shop / order / pick counts (live metrics).
- WhatsApp toggle states (whether messages will send on close).
- Audit links to the Session records for past lifecycle actions.

Full decomposition pending — the `shop (backoffice)` reusable has its own internal element tree.

## Test implications

- A test walking the lifecycle must verify only the expected button is visible at each phase. A regression that shows multiple buttons simultaneously is a real bug.
- Pressing a button mid-cycle should be idempotent if pressed twice (the action workflows have guards) — but tests should verify this explicitly, not assume it.
- A user without Distributor/Admin role attempting to call a lifecycle workflow directly (e.g., via API URL) must be rejected — the workflows are auth-bypassed but role-gated at the page; this is a soft guarantee worth testing.
