---
title: "Daily Pick History List"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The grower's primary surface on Grower Home. Despite its name in the codebase, this is **not** an inline pallet-entry grid — it is a **list of past Daily Pick header records** for the grower's company, with today's pick at the top.

## Data displayed per row

Each row shows two pieces of header information:

- **Date** — the trading date of that pick.
- **Status** — the pick's current state (Draft, Submitted, or Closed; see [Pick Status Transitions](../../business_rules/pick_status_transitions.md)).

The list is sorted by created date, newest first. Today's pick — pre-created by the [Daily Pick Bootstrap](../../backend_flows/daily_pick_bootstrap.md) — is always the top row when the grower lands on the screen.

## Pallet entry is INLINE in the row — not in a popup

**Correction from earlier read:** the actual pallet-count editor lives in `Group content/Group status/` inside each row, NOT in a popup. The `Group status` element binds to the pick's status field and renders Text C which displays the current pallets/leftover totals; its conditional states control border color based on whether the pick is closed and whether there's still available supply.

What this means for the grower's flow:

- Pallets-picked editing happens directly in the row (inline).
- Comments are edited via a popup (see Popup chain below).
- Other popups display contextual info (variety details, status hints) but do not contain editable inputs.

## Row buttons and popup chain

Each row exposes five buttons (B, C, D, E, F):

| Button | Action                                                           | Notes                                                                        |
| ------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| B      | Toggles Popup A copy 2 (info display)                            | Shows additional pick info — read-only display popup                         |
| C      | Toggles Popup A copy 2 (info display)                            | Same target as B; possibly an alternate trigger or a state-dependent variant |
| D      | Toggles a popup (3 workflow variants — likely state-conditional) | One variant per pick state (Draft / Submitted / Closed?)                     |
| E      | Toggles a popup (3 workflow variants)                            | Same pattern as D                                                            |
| F      | Toggles a popup (3 workflow variants)                            | Same pattern as D                                                            |

Five popups (Popup A copy, copy 2/3/4/5) exist; **only Popup A copy 5 has an editable input** — a multiline comment field. The other four are info-display popups bound to different pieces of pick metadata.

Clicking the row body (outside the action buttons) triggers a "navigate tab" custom event — drilling into the pick.

## Group status — conditional border styling

The `Group status` element has two conditional states that change its border color:

- Border becomes `bTIDD` (a "closed" color, likely red or grey) when the pick's status is non-Draft AND the day's arrangement is Closed → signaling "this pick is locked".
- Same color when there are temp/non-deleted pick-product lines with `pallets_picked + leftovers > 0` AND the pick's status is non-Draft → signaling "this pick has unsold supply requiring attention".

These are testable UI signals.

## Why this matters for the user flow

The grower's editing surface is **inside popups**, not on the list itself. The list is a chooser. A new tester or developer modeling the "submit a pick" flow must walk: list-row → action button → popup → in-popup edit → in-popup submit — not a single inline form.

## Out of scope for this node

The popups (`Popup A copy`, `Popup A copy 3`, `Popup A copy 4`, `Popup A copy 5`) are separate components and warrant their own PRD nodes. They are not described here; each holds its own per-pick editing UI and submit action.
