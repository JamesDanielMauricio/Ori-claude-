---
title: "Close Arrangement (Phase 4 — terminal)"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Distributor-triggered. The terminal step of the trading day — the most consequential single workflow in the platform's daily flow, with nine actions and many downstream effects (locks picks, dispatches WhatsApp, resets the day). Several other workflows (e.g., `create_growers_data`) have more individual actions but are bootstrap utilities, not terminal lifecycle steps.

## In plain language (for non-technical readers)

When the Distributor presses **Close Arrangement** at the end of a trading day, the platform does five user-visible things:

1. Marks the day's arrangement as final — no more changes from the Distributor.
2. Locks every grower's daily pick (they can no longer edit pallet counts for this day).
3. Sends a WhatsApp message to every customer whose order was fulfilled, listing what was arranged for them — with prices when the customer's company is configured to see them.
4. Sends a similar message to every grower whose pick was used in the arrangement.
5. Resets the platform's "what day is open" flags so tomorrow's trading day can be initiated cleanly.

WhatsApp dispatch only happens if the platform's WhatsApp toggles are turned on (see Operational notes below).

## Inputs

- `app settings` — singleton config.
- `date` — the trading date.

## Actions (9)

1. **Create Session.** Type = `end_the_day`, user = current, complete = true.
2. **Reset App Settings comprehensively.** Seven field changes:
   - `visible_buttons` → "open" (ready for next day's initiate)
   - `active_daily_pick_data_list` → empty
   - `active_daily_arrangement` → empty
   - `active_daily_shop` → empty
   - `list_of_active_daily_order_data_list` → empty
   - `day_status` → "closed"
   - `shop_status` → "close"
3. **Compute WhatsApp eligibility.** Trigger a Boolean custom event that returns true iff BOTH `whatsapp_toggle` = on AND `whatsapp_toggle__messages_to_customers_when_closing_the_day_` = on. The boolean result governs whether actions 7 and 8 execute.
4. **Update Daily Arrangement.** Search for the arrangement matching the date, set status → Closed.
5. **Mass-close Daily Picks.** ChangeListOfThings on every Daily Pick for the date: status → Closed. This is what locks grower edits for the day.
6. **Reset Product Variety highlight flag.** ChangeListOfThings on every Product Variety: `highlight_price_fluctuations` → false. Clears the day's pricing-change signal.
7. **WhatsApp dispatch — company batch.** For each company that has both arrangement records (> 0 pallets) and orders (status ≠ Open) AND a `group_id (whatsapp)` set: schedule `send_whatsapp_message` with the formatted arrangement summary. Gated by step 3's boolean result.
8. **WhatsApp dispatch — user batch.** For each user whose company has arrangement + orders but NO group_id: schedule `send_whatsapp_message` to their individual phone, with 972 country prefix and leading 0 stripped. Gated by step 3's boolean result.
9. **Populate prices.** Trigger `populate prices` custom event with the day's arrangement records. Sets final prices based on price types.

## Message template

The WhatsApp template comes from a `main_alert` record. It uses placeholders `%FIRST_NAME%`, `%ORDER_DETAILS%`, `%CURRENT_OPEN_BUSINESS_DAY%`, `%NL%`. Find/replace substitutes the per-recipient values. The arrangement summary lists, per line:

- Family name and variety (with size).
- If the customer's company has `can_see_product_prices = true`: a price string per the variety's price type.
- The pallet count assigned.
- The grower's company name.

## What is locked vs reset

Locked (won't change after close_arrangement):

- Daily Arrangement records and their statuses.
- Daily Picks (now Closed).
- The Session record.

Reset (cleared for the next day):

- App Settings active references.
- Per-variety price-change highlights.

Not directly touched (transient):

- Daily Order status — needs verification whether it's also transitioned here or downstream.

## Privacy

Runs with privacy bypassed. Cross-company reads and writes throughout.

## Idempotency contract

The workflow has **no explicit double-call guard**. Pressing the Close Arrangement button twice in quick succession would attempt the workflow twice. Observed behavior:

- Action 1 (NewThing → Session) creates a duplicate Session record on the second call. Not a corruption, but a misleading audit trail.
- Action 2 (App Settings reset) is idempotent — re-emptying already-empty fields is a no-op.
- Action 4 (Daily Arrangement → Closed) is idempotent.
- Action 5 (mass-update Daily Picks → Closed) re-applies on already-Closed picks; no functional damage.
- Action 6 (clear price-fluctuation flags) is idempotent.
- Actions 7 & 8 (WhatsApp dispatch) **are not idempotent** — a second call would resend messages to the same recipients.
- Action 9 (populate prices) re-runs against the same arrangement records.

**Net contract:** a double-click sends duplicate WhatsApp messages and creates an extra Session. Other state remains consistent. Tests that simulate concurrency should expect this duplicate-send behavior, not assume idempotency.

## Test implications

- Test the full reset of App Settings — all **seven** field changes in Action 2: `visible_buttons`, `active_daily_pick_data_list`, `active_daily_arrangement`, `active_daily_shop`, `list_of_active_daily_order_data_list`, `day_status`, `shop_status`. Missing any one leaves a stale state that breaks the next initiate.
- Test the mass-pick-close: every Daily Pick for the date must end up Closed, including ones that were never Submitted (the workflow does not filter by status).
- WhatsApp dispatch must be verified in both modes: toggles ON (messages sent) and toggles OFF (no messages, workflow still completes).
- The Session record must capture who closed the day — critical for audit.
- Double-click test: per the Idempotency contract above, a second call DOES resend WhatsApp and creates a duplicate Session. Tests asserting "no duplicate side effects" will fail — and rightly so; this is a real product bug, not a test miscalibration.
