---
title: "Sidebar — Customer/Grower"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A persistent floating panel on the right side of the desktop layout of Grower Home and Customer Home. The panel mounts the same reusable element on both pages — the role distinction is entirely inside the component's conditional states.

## Sections

### Upper — company identity strip

Mirrors the header's identity strip: company logo, user avatar, company name, first name. Display-only.

### Navigation tab list

A repeating group of tab buttons. The list itself is driven by a parameter passed from the host page — Grower Home and Customer Home each pass a different list — but the rendering and click handler are identical. Each tab's label is text from the parameter; the highlighted state is computed by comparing the tab's slug to the current URL `tab` parameter.

Tap behavior: triggers the "navigate data" custom event → updates URL → host page swaps content area.

### Primary day-action button

A prominent labeled button below the navigation. Visible to both roles; label and enable condition differ:

| Aspect           | Grower                                                | Customer                                               |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Label            | "עדכון [date]" (Update [date])                        | "הזמנה [date]" (Order [date])                          |
| Enable condition | A Daily Pick for today exists for this user's company | A Daily Order for today exists for this user's company |

When tapped, it routes the user into their day-specific working surface (same target as the hamburger's primary action).

### Sign Out button

Always visible at the bottom of the sidebar. Triggers the platform sign-out and redirects to the login page. Label is in English ("Log out") — note this is the only English-labelled control in the panel; everything else is Hebrew. Could be intentional or a copy oversight.

## Role swap is text + enable, not visibility

Crucially, **both roles see the same buttons** — only labels change and the day-action enable condition differs. Tests asserting role isolation should NOT expect any button to disappear; they should assert:

- Labels match the role (and language).
- The day-action button is enabled only when the role-specific day record exists.
- The navigation list contents (passed in as a parameter) match the host page's tab list.

## Backoffice does not use this sidebar

Distributors and Admins on the Backoffice page use the `side_bar_v2` reusable — a different component with a different tab list and management actions. That component lives in the Distributor module.

## Test implications

- A Grower from Company A and a Grower from Company B both see the same component shape; only the identity strip differs.
- Sign Out must work from every page that mounts this component.
- The day-action enable state must update in near-real-time when the underlying day record is created (e.g., when the Distributor initiates the business day, the Grower's day-action should become enabled on next page render).
