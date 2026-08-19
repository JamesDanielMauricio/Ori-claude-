---
title: "Header Menu"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A horizontal strip rendered at the top of two screens — Grower Home and Customer Home. The Backoffice page uses a different component (`side_bar_v2`) and does not mount this header.

The header itself is informational; all navigation comes from the hamburger dropdown it owns.

## Children of the bar

| Element                             | Purpose                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Company logo                        | Static image of the user's company logo. Not clickable.                   |
| User avatar                         | Display-only image.                                                       |
| Company name                        | The current user's company name (e.g., "ליאור הרפז שיווק"). Display-only. |
| User first name                     | The current user's first name. Display-only.                              |
| [Hamburger icon](hamburger_menu.md) | Tappable. Toggles an overlay menu. The menu's contents are role-filtered. |

## Visibility

- The header is **hidden by default** while the host page bootstraps. It becomes visible after the page's data context has loaded. This prevents a "flash of header without identity" during initial load.
- On the desktop layout, the header is only mounted when the page's width condition allows it — narrower viewports show the header full-width; wider viewports may hide it in favor of the floating sidebar.

## Test implications

- Both the Grower and Customer screens must show the same physical header component. A regression that diverges them (different logo size, missing avatar on one) is a real bug.
- The displayed company name must match the logged-in user's company — tested by logging in as users from different companies and asserting the strip swaps.
