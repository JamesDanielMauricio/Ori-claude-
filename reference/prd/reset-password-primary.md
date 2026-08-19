---
title: "Reset Password (primary)"
node_type: screen
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The active password reset page is `/reset_pass` — which takes the target user as a page-data parameter and asks for **admin credentials** (admin email + admin password) plus a **new password** for the target user. The flow is therefore admin-mediated: an Admin or Distributor resets a user's password by visiting this page with the user context and entering their own credentials to authorize the reset.

The companion `/reset_pw` is a simpler card with just "new password + confirm new password" — likely the user-facing destination when a reset email link is followed (the user has already authenticated via the token in the URL).

## `/reset_pass` form

| Field          | Hebrew label                           | Type               |
| -------------- | -------------------------------------- | ------------------ |
| Admin Email    | אימייל                                 | text, required     |
| Admin Password | (no visible label, password input)     | password, required |
| New Password   | ססמא חדשה                              | password, required |
| Submit Button  | אישור ססמא חדשה (Confirm New Password) | button             |

## Submit chain on `/reset_pass`

Pressing submit triggers a chain of custom events:

1. **Validate admin email** against a custom state.
2. **`change pass`** custom event (6 actions):
   - Set a temporary password on the target user.
   - Log in as the target user using the temporary password.
   - Update the target user's credentials to the new password.
   - Persist the change.
   - Reset the custom state.
   - Clear the form inputs.
3. **`navigate`** custom event (6 actions):
   - Log in as the admin using their entered admin email + admin password.
   - Route to the correct page based on the admin's role (Admin → Backoffice, etc.).

The flow ends with the **admin** logged in (not the target user), routed to their home page.

## `/reset_pw` form (simplified — and non-functional)

| Field                | Hebrew label    | Type               |
| -------------------- | --------------- | ------------------ |
| New password         | ססמא חדשה       | password, required |
| Confirm new password | אישור ססמא חדשה | password, required |

**Verified by direct source read:** the submit button on `/reset_pw` triggers a workflow named `Button Clicked on Button B` that contains **ZERO actions**. The submit button is wired up but does nothing. Pressing it has no effect on the platform's state.

This means the `/reset_pw` page is **effectively non-functional** in the current production code. A user reaching `/reset_pw` and entering their new password will see the form clear (default Bubble form behavior) but no credential update occurs.

**Implications for the user-facing "Forgot Password" flow:**

- The admin-mediated `/reset_pass` flow is the only functional reset path.
- An end user clicking "Forgot Password" (if such a link exists in the UI) and being routed to `/reset_pw` would hit a dead end.
- This is either a known unfinished feature or a regression.

This is a real product gap that should be either fixed (wire up `/reset_pw` actions) or removed (remove the page entirely and any links to it) — leaving a non-functional reset page in production is a UX liability.

## Disabled workflows on `/reset_pass`

Two workflows are present-but-disabled:

- A `Page Loaded` workflow that would set a temporary password on page load.
- A `Condition True: Page data is yes` workflow that would alternately trigger reset.

These represent earlier versions of the flow; they are not active. Tests should not rely on them.

## Test implications

- The flow requires the admin's correct credentials — wrong admin password must abort the reset before any user data is changed.
- After reset, the target user's password is the new password — verify by attempting to log in as the target user with the new credentials.
- The admin is the one logged in at the end of the flow — the target user is not automatically logged in.
