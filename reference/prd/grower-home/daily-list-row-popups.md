---
title: "Daily List Row Popups"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A family of five small popups (each 277×263 px) attached to the row buttons B–F on the Daily Pick History List. Each popup is toggled by a specific button click.

## Popup A copy — info display

Smallest of the five. Contains one image (Image C) + one text (Text F). Likely an icon + caption pattern — a status hint or quick-info readout.

**Not editable.** Display-only.

## Popup A copy 2 — info display

Contains an image (Image D), two text elements (Text I, Text J), and a Group D container. Likely the primary "row details" popup — variety info, supply numbers, pickup time at a glance.

**Not editable.** Display-only.

Toggled by both Button B and Button C — possibly two entry points to the same content, or a state-conditional secondary trigger.

## Popup A copy 3 — info display

Contains an image (Image E), two Text K elements (variants), and a Group J container. Similar shape to copy 2 but bound to different data — possibly status history or activity log details.

**Not editable.** Display-only.

## Popup A copy 4 — info display

Contains an image (Image F), two Text L elements (variants), and a Group K container. Similar shape to copies 2 and 3 — bound to another slice of pick data (possibly leftovers, or the arrangement record link).

**Not editable.** Display-only.

## Popup A copy 5 — comment editor (the only editable popup)

Contains a multiline text input (MultilineInput A, 226×100 px), a title text (Text M), and a Group L container.

The multiline input has a Hebrew placeholder ("הערה עם הרבה הערה עם הרבה..." — repeating "comment with a lot" — clearly placeholder text, not the real label). When the grower enters text and confirms, the comment is saved to the row's Daily Pick Product line.

**Editable.** This is the only popup in the chain where the grower writes data.

## What's NOT in any popup

- **Pallets-picked count** — edited INLINE in the row's `Group status` element.
- **Pickup time** — also INLINE (in another sub-group of the row).
- **Submit action** — triggered by the inline submit button, not by a popup confirmation.

The popup chain is for ancillary info display + one editable field (comments). The primary editing surface is the row itself.

## Test implications

- A grower entering a pallet count must trigger an inline change to the row's bound Daily Pick Product. Tests should expect immediate save (no "save in popup" round-trip).
- A grower entering a comment via Popup A copy 5 must result in the row's `comment_text` field updating after the popup's confirmation action fires.
- Tests must not expect any pallet-count input in any popup — that's a misconception worth explicitly disproving in a regression test.
- The four read-only popups are good targets for visual-regression tests but do not anchor data assertions.
