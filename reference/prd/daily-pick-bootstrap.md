---
title: "Daily Pick Bootstrap"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

System-only. Runs for each grower company when the trading day is initiated. Two modes: **initial run** (first time the day is bootstrapped) and **rerun** (re-bootstrap, used when the day is re-initiated or the catalog changes mid-day).

## Inputs

- A list of grower companies to bootstrap.
- A target trading date.
- A **rerun** flag (boolean).
- The app settings record (carries the day's initiation timestamp and the running list of active daily picks).

## What it does, in order

1. **Update the grower company's default pickup time** to today at the company's stored hour-and-minute. This shifts the company's default from "yesterday at 2pm" to "today at 2pm" — the new Daily Pick will inherit it.

2. **Create the Daily Pick (if not already present).** Guarded by: the app-settings active-picks list does not already contain this company. New record is created with:
   - Linked grower company = the input company.
   - Date = the input date.
   - Status = Draft.
   - Pickup time = the company's now-updated default.

3. **Register the new pick in app settings** by appending it to the active-daily-picks list. (Only runs if step 2 actually created a record.)

4. **Rerun-only cleanup of out-of-season arrangements.** Guarded by `rerun = yes`. Deletes any Daily Arrangement records whose linked Daily Pick Product references a produce variety no longer in the company's in-season list.

5. **Cleanup of out-of-season Daily Pick Product lines** — runs unconditionally (both initial and rerun). Deletes any pick-product line for this company on this date whose product variety is not in the company's in-season list.

6–8. **Schedule per-line creation jobs.** Three branched schedules call `create_daily_pick_product_datas` — one per product variety in the company's in-season list:

| When                                               | Source pick                                         | Effect                                                                                           |
| -------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `rerun = yes` AND a new pick was created in step 2 | the new pick                                        | Fresh lines on a fresh pick                                                                      |
| `rerun = yes` AND no new pick (it already existed) | the most-recent existing pick for this date+company | Fresh lines on the existing pick — overwrites the per-variety lines but the pick header survives |
| `rerun = no` (initial run)                         | the new pick                                        | Standard initial bootstrap                                                                       |

## What rerun preserves vs. discards

- **Preserved:** the Daily Pick header record (when one already exists). Status, submission time, and activity history on that header are not reset.
- **Discarded:** Daily Pick Product line items for products that are no longer in season (step 5) and Daily Arrangement records that referenced them (step 4). In-season lines are also rebuilt by the scheduled jobs (steps 6–8), which means previously-entered pallet counts on those lines are **not preserved by this flow alone** — whether the per-line creation job preserves them depends on `create_daily_pick_product_datas`, which is a separate node.

## Privacy

This flow runs with privacy bypassed. It is a system actor operating across all grower companies and is not exposed to user-facing role checks.

## Trigger surface

This flow is invoked as part of the distributor's day-initiation step in the daily-shop lifecycle. It is **not** user-callable from the grower interface. The Distributor's "Initiate Business Day" button calls [initiate_business_day](../../03_distributor/backend_flows/initiate_business_day.md), which then schedules `create_growers_data` per grower — and that workflow chains into this bootstrap.

## Test implications

- After a clean initiate, every active Grower company with a non-empty in-season list must have a Daily Pick (status: Draft) and one Daily Pick Product per variety in the season list.
- A grower with status Inactive must NOT receive bootstrap data.
- A grower with an EMPTY in-season list must NOT receive bootstrap data — verify symmetrically. This is a known footgun.
- Rerun mode: an existing Daily Pick header is preserved (Action 2's guard). Status, Submission Time, and Activity History on the pick header survive a rerun.
- Daily Pick Product lines for varieties no longer in season are deleted (Action 5).
- In-season lines are rebuilt by the scheduled jobs in Actions 6–8.
- **Pallet-count preservation across rerun is a function of `create_daily_pick_product_datas`, which is not yet decomposed in this PRD pass.** Until decomposed, tests should NOT assume pallet-count preservation across rerun.
