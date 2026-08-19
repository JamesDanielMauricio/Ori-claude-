---
title: "Daily Check for Empty Orders"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A **Recurring Event** workflow — Bubble's cron-style scheduling. Runs against a `daily_checking_of_empty_orders` data type (likely a queue/log table tracking what was checked).

## Action (1)

- **ScheduleAPIEventOnList → `delete_empty_order`** — dispatches the deletion workflow for the list of empty order records identified.

## Trigger surface

This workflow runs **on a schedule** (configured via Bubble's recurring event mechanism, not visible in the export). It is the platform's daily cleanup pass — finding orphaned or empty order lines that accumulate from customer interactions and clearing them.

## Privacy

Runs with `Ignores Privacy: yes`. As a system actor it iterates across all customer companies' orders.

## Why this exists

Customer order entry through `save_order_line` can leave Daily Order Product records with `no_of_pallets_new = 0` or null — typically when a customer enters and then deletes an order. The workflow's per-call delete guards (Actions 3 and 4 of `save_order_line`) catch most of these in real-time, but a daily sweep catches any that slip through.

## Test implications

- A test that creates a daily order, sets line counts, then sets them back to 0 should NOT leave residual rows after the next scheduled run.
- The recurring event's exact schedule (every day at what time?) is not visible in the export — operational note: the schedule lives in Bubble's recurring-events config, not in the workflow file itself.
- Tests should not assume immediate cleanup; the cron sweep runs once daily.
