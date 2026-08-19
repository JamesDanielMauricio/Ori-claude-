---
title: "Session — Lifecycle Audit Record"
node_type: entity
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A record created by the major lifecycle workflows to capture **who did what when**. Append-only — sessions are never updated or deleted.

## Key fields

| Field        | Type                | Notes                                                                 |
| ------------ | ------------------- | --------------------------------------------------------------------- |
| Date         | date                | The trading date the session relates to.                              |
| User         | reference → User    | Who triggered the lifecycle step.                                     |
| Session Type | option:session_type | Which step (`close_shop`, `end_the_day` for close_arrangement, etc.). |
| Complete     | boolean             | Set to `true` on creation by current workflows.                       |

## When sessions are created

- `close_shop` action 3: a Session with type `close_shop`.
- `close_arrangement` action 1: a Session with type `end_the_day`.
- (Other workflows may also create sessions; left to verify as the Distributor module is built out.)

## Why this matters

The Session collection is the platform's lifecycle audit trail. Reading sessions chronologically reconstructs the trading-day history — useful for support, compliance, and debugging.

## Test implications

- Every close-shop and close-arrangement test must verify a Session record was created with the right `session_type` and the acting user.
- Sessions are not visible to growers or customers — they are an Admin/Distributor concern.
