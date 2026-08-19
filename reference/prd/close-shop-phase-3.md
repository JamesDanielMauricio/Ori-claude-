---
title: "Close Shop (Phase 3)"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Distributor-triggered. Ends the customer order window.

## Inputs

- `app settings` — singleton config.
- `date` — the trading date.

## Actions (3)

1. **Update App Settings.** `visible_buttons` → "close_arrangement" (signal that next action is to close the arrangement), `shop_status` → "close".
2. **Update Daily Shop.** Status → Closed.
3. **Create Session.** A new Session record with `session_type = close_shop`, `user = Current User`, `complete = true`, `date = today`.

## What does NOT happen at close_shop

- Daily Picks are NOT closed (that happens at close_arrangement).
- Daily Orders are NOT transitioned (their status remains Submitted; the close-arrangement step is what conceptually moves them to Scheduled).
- WhatsApp messages are NOT sent.

This is significant: close_shop is intentionally a **soft close** — it stops accepting new customer orders but preserves the Distributor's window to build the arrangement before the day terminates.

## Privacy

Runs with privacy bypassed.

## Test implications

- After close_shop, customer order entry must reject new orders (the Daily Shop's status is Closed; the access guard on the order form should check this).
- Grower pick editing must still be allowed at this point — picks stay Submitted, edits continue to fire the out-of-stock trigger.
- The Session record must be created — operational audit relies on this.
