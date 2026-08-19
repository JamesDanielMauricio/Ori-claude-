---
title: "Page Data-Popup Pattern"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A convention used by every authenticated page in the app. Despite the name, the "Popup data" container is **not a popup** in the user-visible sense — it is a hidden element used as a data-loading scaffold. It reads URL parameters and pre-fetches records so the main page content can bind to them synchronously.

## What lives inside

Each authenticated page has a `Popup data` group with several sub-groups, each pulling one piece of context:

| Sub-group             | Reads                                        | Purpose                                                                    |
| --------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| App Settings data     | The singleton app_settings record            | Drives day status, shop status, visible-buttons flag, WhatsApp toggles.    |
| Parameter "tab" data  | URL parameter `tab`                          | Drives which sub-view shows in the main content area.                      |
| Parameter "data" data | URL parameter `data` (typically a record ID) | Deep-link to a specific record (a specific Daily Pick, Daily Order, etc.). |
| Day-specific record   | Computed from app settings + user's company  | The user's current-day pick (Grower) or order (Customer).                  |

Backoffice also has a separate `Popup App settings` group that further reads URL parameters like `edit` and `scroll` for managing edit-mode state and scroll positions during admin operations.

## Why it's structured this way

- **URL is the source of truth for navigation state.** Page reload preserves which tab the user was on.
- **Pre-fetched context** means binding expressions on the main content area don't have to re-fetch — improves perceived speed.
- **Conditional workflows on the page** can run guards before the main content renders (e.g., "if no tab parameter, redirect to default").

## Page-load guards

Every authenticated page mounts a set of `Condition True_ ...` workflows that fire as the page renders. Universal guards across all authenticated pages:

| Guard                 | When it fires                                        | Action                                                                                          |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Not logged in         | Current User is null on page load                    | Redirect to login.                                                                              |
| Wrong role            | Current User's role is not the role this page is for | Sign the user out **and** redirect to login. (A hard reset, not a soft "access denied" banner.) |
| Missing tab parameter | URL has no `tab`                                     | Redirect to the same URL with a default tab — a self-correction.                                |

The role mismatch guard is per-page: Grower Home rejects non-Growers; Customer Home rejects non-Customers; Backoffice rejects everyone except Admin and Distributor. See each module's `*_access_gating.md` rule for the specifics.

## Test implications

- A direct-URL navigation (paste a deep link, then load) must render the same UI as following an in-app link to the same destination. The data-popup pattern guarantees this — tests should verify it.
- A user without the page's required role typing the URL must be **signed out**, not just shown a 403. This is a deliberate UX choice and must be preserved in tests.
- The default-tab redirect should never loop. A page loaded with `tab=` should never bounce indefinitely.
