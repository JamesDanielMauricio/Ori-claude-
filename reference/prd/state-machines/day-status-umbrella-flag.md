---
title: "Day Status — Umbrella Flag"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The `app_settings.day_status` field is the **umbrella state** of the entire trading day. It steps through values as the distributor progresses through the four-phase lifecycle (initiate → open → close shop → close arrangement). UIs and workflows read it to determine which action buttons are valid and which records are "live".

## Values observed in the code

**Verified by grep across all `Backend Workflows/`** — `day_status` has only **two** code values that are ever assigned:

| Value               | Set by                             | Meaning                                              |
| ------------------- | ---------------------------------- | ---------------------------------------------------- |
| `day_status:open`   | `initiate_business_day` (Action 2) | A trading day has been initiated and is in progress. |
| `day_status:closed` | `close_arrangement` (Action 2)     | The trading day has terminated. The day is over.     |

There are no intermediate `day_status` values for "shop open" or "close-arrangement pending". Those phase transitions are tracked entirely by **other** App Settings fields: `visible_buttons`, `shop_status`, `arrangement_status`. `day_status` is a binary umbrella flag — "is a day active, yes or no?"

## Dual-write with the legacy `visible_buttons` field — by design

`day_status` does NOT replace the legacy `visible_buttons_option_app_setting_s_current_daily_shop_status` field — both are written by the lifecycle workflows. Specifically, `close_arrangement` Action 2 sets:

- `visible_buttons_option_app_setting_s_current_daily_shop_status: open` (resets the UI signal so the next "Initiate Business Day" button is shown)
- `day_status_option_day_status: closed` (sets the umbrella flag to "day over")

Both fields are live and serve different purposes:

| Field             | Purpose                                                                      | Cardinality                                                        | Read by                             |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| `day_status`      | Umbrella "is a day active" flag                                              | Binary (`open` / `closed`)                                         | Workflow guards, audit logic        |
| `visible_buttons` | UI signal — which lifecycle button to render on the Backoffice control panel | Multi-value (`open` / `awaiting` / `closed` / `close_arrangement`) | Backoffice UI conditional rendering |

This is **intentional dual-write**, not a migration in flight. Tests that anchor on either field are valid; tests that assume one supersedes the other are wrong. If you find both fields in a workflow's field changes, that's expected.

## Why this is an umbrella flag

The shop, arrangement, and pick all have their own status fields. But the distributor's UI needs **one** flag that says "what phase of the day are we in" so the right action button is visible at each step. `day_status` is that flag.

The companion flag is `app_settings.visible_buttons` (an option-set with values like `open`, `close_arrangement`, etc.) — it's a UI-level flag that tells the Backoffice screen which button to render next. Together, `day_status` + `visible_buttons` + `shop_status` + `arrangement_status` + per-record statuses form the day's full state.

## Test implications

- A regression that resets `day_status` mid-cycle (e.g., a bug in close_shop that prematurely sets it to "closed") would hide the close-arrangement button from the Backoffice — test by walking the full lifecycle and asserting the expected button is visible at each step.
- `close_arrangement` is the only workflow that sets `day_status = closed`. A test of any other workflow that ends with `day_status = closed` is asserting a regression.
