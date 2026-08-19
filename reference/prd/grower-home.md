---
title: "Grower Home"
node_type: screen
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A grower lands here directly after login. The screen has two display modes selected by a tab parameter in the URL:

- **Daily List mode** — the active production interface; shows the day's pick lines as a list the grower edits and submits.
- **Legacy Product mode** — an older product-by-product entry interface, retained but not the primary path.

If the tab parameter is missing on arrival, the screen self-redirects to the default tab so a grower never sees a blank state.

## Access guard

Before any content renders, the screen enforces [Grower Access Gating](../../business_rules/grower_access_gating.md): non-authenticated users are redirected to login; authenticated users without the Grower role are logged out and redirected to login.

## Components

- [Header Menu](../../../00_shared/components/header_menu/_index.md) — shared with Customer Home. The header on this page mounts the same component; see the shared node for full behavior.
- [Daily Pick History List](daily_list.md) — grower-specific. The list of past picks; pallets-picked is edited INLINE in the row, comments via the row popup chain.
- [Row Popups](row_popups.md) — five small popups (A copy through copy 5). Four are info-display; only copy 5 (the comment editor) accepts input.
- [Floating Sidebar](../../../00_shared/components/sidebar/_index.md) — shared with Customer Home. On this page renders the Grower labels ("עדכון [date]" for the primary action, "הסטורית עדכונים" for history).

## Data context

The screen carries four pieces of data sourced at load time:

- The grower's current-day Daily Pick (matched by today's date + the grower's company).
- The Daily Pick identified by the `data` URL parameter, when present (deep-link to a specific day).
- The global app settings record (drives shop status and feature toggles).
- The active tab parameter (`list` or `data`).
