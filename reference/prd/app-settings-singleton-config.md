---
title: "App Settings — Singleton Config"
node_type: entity
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A single record (the platform expects exactly one) that carries the global state of the trading cycle.

## Key fields (business meaning only)

| Field                                  | Type                                           | Notes                                                                                                                 |
| -------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Current Initiation Date and Time       | date                                           | The timestamp when the current trading day was initiated. Used to compute today's default pickup times for growers.   |
| Day Status                             | option:day_status                              | The umbrella state of the trading cycle — see [Day Status](../state_machines/day_status.md).                          |
| Shop Status                            | option:shop_status                             | The current Daily Shop's status, mirrored for fast page-level reads.                                                  |
| Visible Buttons                        | option:app_setting_s_current_daily_shop_status | UI-level flag telling Backoffice which action button is the "next" valid one (open / close_shop / close_arrangement). |
| Active Daily Shop                      | reference → Daily Shop                         | The current trading day's shop record. Cleared when arrangement closes.                                               |
| Active Daily Arrangement               | reference → Daily Arrangement                  | The current arrangement record. Cleared when arrangement closes.                                                      |
| Active Daily Pick List                 | list of references → Daily Pick                | Every grower's pick for the current day. Cleared when arrangement closes.                                             |
| List of Active Daily Orders            | list of references → Daily Order               | Every customer's order for the current day. Cleared when arrangement closes.                                          |
| WhatsApp Toggle                        | option:toggle                                  | Global on/off for outbound WhatsApp.                                                                                  |
| WhatsApp Toggle — Customer Closing Day | option:toggle                                  | Specific toggle for the close-arrangement customer dispatch.                                                          |
| Can See Prices                         | boolean                                        | The day's price-visibility default for customers.                                                                     |

## Why one singleton

The trading day is global — there is only ever one open shop at a time, one active arrangement, one set of active picks. A single config record holds that state so every page and every workflow reads the same source of truth.

## Lifecycle interactions

- `initiate_business_day` sets the initiation timestamp and bumps day_status.
- `creating_daily_shop_data` and `open_shop` set active_daily_shop and visible_buttons.
- `close_shop` flips shop_status and visible_buttons to "close_arrangement".
- `close_arrangement` clears all active references and resets day_status to "closed", shop_status to "close".

## Test implications

- App Settings is read by every page. A test that mutates app_settings in the middle of a flow can produce surprising side effects on other open pages — keep mutations confined to lifecycle steps.
- The "active" list fields are filled by bootstraps and emptied by close_arrangement. A test asserting "the day is over" should check that all four active fields are empty.
