---
title: "Role-Based Routing"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

When a user successfully authenticates — whether by signing in, saving their profile, or being logged in as part of the password-reset flow — the platform consults their role and routes them to that role's home page.

## The routing table

| Role                | Destination                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin (מנהל מערכת)  | `/backoffice`                                                                                                                                                                                                                                                                                                                                                                                                              |
| Distributor (משווק) | `/backoffice`                                                                                                                                                                                                                                                                                                                                                                                                              |
| Grower (מגדל)       | `/grower_interface`                                                                                                                                                                                                                                                                                                                                                                                                        |
| Customer (לקוח)     | `/customer_interface`                                                                                                                                                                                                                                                                                                                                                                                                      |
| Transporter (מוביל) | **No destination — by design.** Transporters are WhatsApp-only recipients with no in-app UI. The `navigate` event has no Transporter branch. A Transporter who successfully authenticates is stranded on the login page (the workflow's role checks all fail). This is intentional, not a bug. Tests should NOT attempt to log in as a Transporter and assert any destination; that scenario doesn't exist in the product. |

## Where this rule is implemented

The `navigate` custom event appears on multiple pages (the login form's `Signup_Login` reusable, the user profile page, the reset_pass page). Each implementation contains a chain of role-checked `ChangePage` actions. The first matching role wins; the workflow terminates after the first successful match.

## Implications of the role-first-match pattern

- Adding a new role requires updating every `navigate` event implementation that exists. A new role with no entry in `navigate` will silently fail to route — the user remains on the current page.
- Changing a role's destination requires updating every `navigate` event.
- The duplication is a real maintenance risk. Worth flagging operationally.

## Corrupt / orphan user records

A user whose role is null, or whose company link is broken, fails every role branch in the `navigate` event. The workflow does not have a catch-all final action — the user remains on the page where the navigate was triggered (login, profile, reset_pass).

**Observed behavior:** the user appears authenticated (the login succeeded) but is stranded on the login page (or profile page) with no error message and no redirect. They can refresh, log out, or close the tab — but they cannot reach any role-specific UI.

**Operational implication:** if a User record is created without a role assignment (e.g., during a partial admin-mediated reset, or a buggy signup flow), the user is effectively locked out without notification. Operators must check User records for null roles when investigating "I can't log in" reports.

## Test implications

- Each role × successful auth must route correctly. Tests should cover all five roles.
- A user with no role: must remain on login page without an error message (the actual observable behavior).
- A user with a role that has no `navigate` branch (forward-incompatible scenario): same as above — stranded.
- Test all entry points to `navigate` (login, save profile, reset pass) and verify they route consistently.
