---
title: "Hamburger Dropdown Menu"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A click-to-open overlay attached to the header's hamburger icon. The menu is the navigation surface for Grower Home and Customer Home; it does not appear in Backoffice.

## Visible items

| Item                                                                                                                                               | Visible when                                                                                                                           | What it does on tap                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **History list** (one entry — label changes by role: "הסטורית עדכונים" / Update History for Grower; "הסטורית הזמנות" / Order History for Customer) | Role is Grower **and** the day's visible-buttons flag ≥ 2, **OR** role is Customer **and** visible-buttons flag ≥ 3. Otherwise hidden. | Navigates the host page to the `list` tab (drilling into the user's history).                                       |
| **Primary day-action button** (label: "עדכון [date]" / Update [date] for Grower; "הזמנה [date]" / Order [date] for Customer)                       | Role is Grower **and** a Daily Pick exists for today, **OR** role is Customer **and** a Daily Order exists for today.                  | Opens the user's day-specific working surface (the edit popup chain for Grower; the order entry form for Customer). |
| **User identity strip**                                                                                                                            | Always — the menu reuses the company logo and user-name strip from its parent header.                                                  | Display-only.                                                                                                       |

## Role-conditional behavior

The menu structure is identical for both roles — what changes is **labels** and **enable conditions**:

| Aspect                | Grower                             | Customer                         |
| --------------------- | ---------------------------------- | -------------------------------- |
| History item label    | "הסטורית עדכונים" (Update History) | "הסטורית הזמנות" (Order History) |
| Primary action label  | "עדכון [date]" (Update)            | "הזמנה [date]" (Order)           |
| Primary action enable | A Daily Pick exists for today      | A Daily Order exists for today   |

Other roles (Admin, Distributor, Transporter) do not render this menu — the header itself is not mounted on Backoffice, and the auth pages have no header at all.

## Tap behavior

Each navigable item triggers a "navigate data" custom event which updates the URL tab parameter on the host page. The host page re-renders its main content area based on the new tab — see [Page Data-Popup Pattern](../page_shell/_index.md).

## Test implications

- A Grower with no Daily Pick for today should see the primary action button **disabled** (or hidden) — testing by logging in on a day before the distributor has initiated the business day.
- A Customer with no Daily Order should similarly see the primary action disabled.
- Switching a user's role (via admin update) should immediately swap the labels on next page render — tested by reloading the page after a role change.
