---
title: "Initiate Business Day (Phase 1)"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Distributor-triggered. The opening move of the trading day.

## Inputs

- `date` — the trading date being initiated.
- `app settings` — the singleton config record.
- `session` — context reference (optional).

## Actions (4)

1. **Create Daily Arrangement.** A new record with status = Open, linked to the input date.
2. **Update App Settings.** Sets `visible_buttons` to "awaiting" (next user action: Open Shop), `current_initiation_date_and_time` to the input date, `active_daily_arrangement` to the just-created record, `day_status` to "open".
3. **Bump grower default pickup times.** For every active Grower company with a non-empty `products_in_season_list`, recompute `default_pickup_time` to today at the company's stored hour:minute. This shifts the grower's default from "yesterday at 9:00" to "today at 9:00".
4. **Schedule per-grower bootstrap.** A `create_growers_data` job is scheduled for each grower company. Each job downstream invokes the [Daily Pick Bootstrap](../../01_grower/backend_flows/daily_pick_bootstrap.md) for that grower, creating their day's Daily Pick + Daily Pick Product lines.

## Eligibility filter on the grower iteration

The action-3 search filters by:

- `type = Grower` (company type).
- `status = Active`.
- `products_in_season_list` non-empty.

A grower with status Inactive or no in-season products is silently skipped. This is a feature: it prevents inactive growers from getting bootstrap records, but it can also be a footgun if an Admin forgets to set the in-season list on a new grower.

## Privacy

Runs with privacy bypassed — it operates as a system actor across all grower companies.

## Mid-cycle re-invoke behavior

The workflow has **no guard** against being invoked while a previous day is still active. If `app_settings.active_daily_arrangement` is already populated (the previous day was not closed), calling initiate again will:

- Create a NEW Daily Arrangement record (Action 1 is unconditional NewThing).
- OVERWRITE `app_settings.active_daily_arrangement` with the new record (the previous reference is lost).
- Overwrite all the day-status flags.

The previous day's records (picks, orders, arrangement record) remain in the database but are no longer linked from app_settings. They become orphans. The platform does not flag this as an error.

**Operational implication:** if a Distributor accidentally presses Initiate Business Day twice on the same day (or before close_arrangement has been run on the previous day), historical data is silently abandoned. There is no UI confirmation prompt and no rollback.

**Status:** a real product risk. Whether to add a guard ("a day is already in progress — close it first?") is a stakeholder decision.

## Test implications

- After initiate, every active grower with in-season products must have:
  - An updated `default_pickup_time` field on their Company record.
  - A scheduled (and eventually completed) bootstrap that creates their Daily Pick.
- A grower added to the platform Active but with no in-season products must NOT receive bootstrap data. This is a regression vector — adding such a grower and expecting them to "just work" is wrong.
- The Daily Arrangement record created here is the input to [close_arrangement](close_arrangement.md) — a test of the full cycle must verify the same record progresses to Closed.
- A test that invokes initiate twice should expect both invocations to succeed (no guard) — and a stranded orphan arrangement record from the first call. This is current behavior, not desired behavior; do not lock in a passing test that says "double-initiate is harmless".
