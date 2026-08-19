---
title: "Open Shop (Phase 2)"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Distributor-triggered. The trading day's "go live" moment for customers.

## Inputs

- `app settings` — singleton config.
- `can see prices?` — whether prices appear in this day's shop. Stored on the new Daily Shop record.
- `session` — context reference.

## Actions (4)

1. **Create Daily Shop.** A new record with `date` set from app_settings's current initiation timestamp; `can_see_prices` set from the input.
2. **Update App Settings.** `current_daily_shop_date_and_time` is stamped, `visible_buttons` → "closed" (signal that next action is to close the shop), `shop_status` → "open", `active_daily_shop` set to the new shop.
3. **Get list of customer companies.** Triggers the `get list of companies` custom event filtered by `type = Customer` AND `status = Active`.
4. **Schedule per-customer bootstrap.** A `create_customer_data` job for each active Customer company. Each job creates that customer's Daily Order header for the day so they have a record to bind to when they open the order form.

## Privacy

Runs with privacy bypassed.

## Test implications

- After open_shop completes, every active Customer company must have a Daily Order header for the day (in status Open).
- The shop's `can_see_prices` flag must be respected by the WhatsApp dispatch on close_arrangement — turning it off should suppress prices in customer messages.
- A test that creates a new Customer company between Phase 1 and Phase 2 should expect that customer to receive an order header — they are included in the iteration if they are Active.
