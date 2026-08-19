---
title: "WhatsApp Messaging"
node_type: integration
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The app sends outbound WhatsApp messages to growers and customers at specific lifecycle moments. The dispatch is a third-party API call wrapped in a backend workflow with an email fallback.

## In plain language (for non-technical readers)

When the Distributor closes a day's arrangement (the final lifecycle step), the platform sends WhatsApp messages to two audiences:

- **Customers** whose orders were fulfilled — each message lists the produce, varieties, pallet counts, and (when the customer's company is configured to see prices) the prices.
- **Growers** whose picks were used — each message lists what was sold from their supply that day.

The messages are sent through a third-party WhatsApp API service. If the API call fails for a particular recipient, the platform sends an email to a single hardcoded address as a fallback (operational risk — see below).

Whether messages are sent at all is governed by two on/off toggles in the platform's configuration.

## When messages are sent

Three distinct triggers send WhatsApp:

| Trigger                                                     | Recipients                                                                           | What the message says (template)                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arrangement closing** (`close_arrangement` actions 7 & 8) | Customers and growers whose companies have arrangements with > 0 pallets for the day | Greeting + arrangement summary (varieties, pallet counts, prices when allowed) + a per-recipient link to today's records. Template stored as a `main_alert` record with placeholders `%FIRST_NAME%`, `%ORDER_DETAILS%`, `%CURRENT_OPEN_BUSINESS_DAY%`, `%NL%`. |
| **All-picked-products-ordered**                             | Distributors (and possibly growers)                                                  | Notification when every product on a grower's pick has been ordered (signals to the distributor that this product is sold out).                                                                                                                                |
| **All-picked-products + overbooking ordered**               | Distributors                                                                         | Similar to above but factoring in the overbooking buffer.                                                                                                                                                                                                      |

## Recipient routing

`close_arrangement` dispatches in two batches:

- **Action 7**: companies whose `group_id (whatsapp)` field is set — message sent to the company's group chat ID.
- **Action 8**: individual users in companies that do NOT have a group ID — message sent to each user's personal phone number, with a `972` Israel country prefix prepended (and a leading `0` stripped if present).

This split exists so a company that wants a single group-chat message gets one, and a company without a group setup falls back to per-user direct messages.

## WhatsApp toggles

App settings carry two toggles:

- `whatsapp_toggle` — global on/off for outbound WhatsApp.
- `whatsapp_toggle__messages_to_customers_when_closing_the_day_` — specific toggle for the close-arrangement customer dispatch.

Both must be ON for the close-arrangement dispatch to fire. This is the Boolean custom event the workflow consults at action 3.

## Send mechanics — `send_whatsapp_message`

A 3-action workflow:

1. Call the third-party WhatsApp API connector with the message body, recipient phone, and recipient type.
2. Terminate (stop) — the workflow exits if the API call succeeded.
3. **If we reach this step (API call failed)**: send an email to `bamapt@gmail.com` containing the failed message details. **The email's Subject line is "Test Notification"** — suggesting the fallback was originally wired up as a developer test and never properly productized.

## Retry policy

**There is no retry.** A failed API call results in exactly one email fallback and the workflow terminates. There is no exponential backoff, no requeue, no per-recipient isolation beyond the workflow's own scheduling (each recipient gets its own `send_whatsapp_message` invocation, so one recipient's failure does not stop other recipients).

Tests of the dispatch workflow should assert:

- One successful API call → no email sent, workflow completes.
- One failed API call → one email sent, workflow completes.
- Mixed batch (some succeed, some fail) → emails sent only for failed ones; the rest are delivered normally.

## Operational risks (require stakeholder decision)

1. **Single-recipient email fallback** — the `bamapt@gmail.com` address is hardcoded into the SendEmail action. If that mailbox is unmonitored, every WhatsApp failure is silently lost. Operationally: this is a single human as the platform's WhatsApp dead-letter queue.
2. **"Test Notification" subject line** — the fallback's email Subject reads "Test Notification", not "WhatsApp dispatch failure". Anyone receiving these would not know what they refer to without context.
3. **Privacy bypass everywhere** — all WhatsApp dispatch workflows run with `Ignores Privacy: yes`. They iterate across companies and users without user-context privacy checks. A bug here could expose another company's order details to the wrong recipient — there is no privacy-layer safety net.

These three points should be reviewed by the platform's Distributor and signed off — they are product decisions, not test concerns.

## Test implications

- A test of the lifecycle close must verify WhatsApp messages are sent **and** match the template — both batches (group-id companies and individual users).
- A test with both toggles OFF must verify no WhatsApp messages are sent and the close-arrangement workflow still completes successfully.
- A test simulating API failure must verify the email fallback fires (and lands in the configured email).
- Per-recipient isolation: a failure for recipient A must not block dispatch to recipients B, C, ... (each is its own scheduled workflow invocation).
- The hardcoded fallback email + privacy bypass + "Test Notification" subject are tracked in Operational Risks above; treat them as known and stable until stakeholder review changes them.
