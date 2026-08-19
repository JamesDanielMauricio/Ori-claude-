---
title: "Create Daily Shop Data (idempotent setup)"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A setup workflow that prepares the day's Daily Shop and its per-variety Daily Shop Product entries. Designed to be safe to call multiple times — only creates a new shop if none exists, only schedules bootstrap for new varieties.

## Inputs

- `date` — trading date.
- `app settings` — singleton config.
- `can see prices?` — whether the shop should expose prices to customers.

## Actions (4)

1. **Create Daily Shop** — only if app_settings has no `active_daily_shop`. New shop's status defaults to Open. Date = page data.
2. **Register the new shop in app_settings** — only if step 1 actually created a record.
3. **Cleanup obsolete Daily Shop Products.** Delete every Daily Shop Product on the active shop where the linked variety is not in any active grower's `products_in_season_list`. This sweeps out varieties that are no longer carried.
4. **Schedule per-new-variety bootstrap.** For each variety that IS in some active grower's in-season list but does NOT yet have a Daily Shop Product on the active shop, schedule `creating_daily_shop_data_part2` to create the Daily Shop Product entry.

## Idempotency model

- Calling twice in a row produces no new shop (step 1's guard fails the second time).
- Cleanup is idempotent — deleting already-gone records is a no-op.
- The bootstrap schedule is a set-difference: only varieties NOT yet on the shop get scheduled.

## Relationship to open_shop

`open_shop` (the phase-2 lifecycle button) creates a new Daily Shop **unconditionally** (no guard). This is different from `creating_daily_shop_data` which has the guard.

The likely intent: `creating_daily_shop_data` is for "ensure the day's shop is set up" (called from setup paths and possibly from the initiate flow's downstream); `open_shop` is for the explicit Distributor action that publishes the shop to customers.

> [GAP] The exact orchestration — whether `creating_daily_shop_data` is called automatically from `initiate_business_day` or as a manual setup step — is not visible from these workflow files alone. Tracing the Distributor's UI button on the Shop Control Panel against the workflow URL would resolve this.

## Test implications

- Calling this workflow twice in a row must NOT create two shops.
- A test that adds a new variety to a grower's in-season list and then calls this workflow must result in a new Daily Shop Product for that variety.
- A test that removes a variety from all growers' in-season lists must result in the Daily Shop Product for that variety being deleted.
