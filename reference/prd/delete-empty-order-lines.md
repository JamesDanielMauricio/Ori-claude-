---
title: "Delete Empty Order Lines"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A single-action API workflow that deletes a list of Daily Order Product records. Runs with privacy bypassed.

## Action

Deletes a list of `daily_order_products`. The exact selection criteria are determined by the caller (the workflow itself does not search — it accepts the list as a parameter implicitly via the action's data source).

## Trigger surface — verified

Caller (verified by grep): `Backend Workflows/daily check for empty orders/1. ScheduleAPIEventOnList.md`. That workflow is named like a periodic / cron-style maintenance job — it searches for and deletes empty `daily_order_products` lines on a schedule.

This is a cleanup/maintenance workflow, not part of the daily lifecycle. The Distributor does not invoke it directly.

## Test implications

- A test that deletes a customer's line via this workflow must verify the row is gone from queries.
- This workflow is destructive and runs with privacy bypassed — operational guardrails should be in place to prevent accidental mass-deletion. Worth flagging for an Admin tools / audit-log review.
