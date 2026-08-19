---
title: "Reset Password (admin-mediated)"
node_type: user_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The active reset flow in the platform. An Admin or Distributor resets another user's password directly — there is no user-facing "I forgot my password" link that sends a reset email visible in this export.

## Preconditions

- The actor (Admin or Distributor) is logged in elsewhere, knows their own credentials, and has identified the target user.
- The actor navigates to `/reset_pass?...` with the target user record as page data.

## Steps

1. **Arrive at `/reset_pass`.** The page binds to the target user.
2. **Enter admin credentials.** The actor's own email and password — this authorizes the reset.
3. **Enter new password** for the target user.
4. **Submit.** Triggers a chain:
   a. Validate the admin email matches a known admin.
   b. **`change pass` custom event**: Set a temporary password on the target user → log in as the target user using the temp password → update the target user's credentials to the new password → reset the form's custom state → clear the inputs.
   c. **`navigate` custom event**: Log in as the admin (using the entered admin credentials) → route the admin to their home page.

## Success state

- The target user's password is the new password (verifiable by attempting to log in as that user).
- The **admin** is logged in at the end of the flow and on their home page.

## Why the unusual session juggling

Bubble's `LogIn` action operates on the current session. To change another user's password without that user being present, the admin temporarily becomes that user (via the temp password), performs the credential update, then logs back in as themselves. The dual-credential form (admin email + admin password + target new password) is what makes the round-trip possible without ever exposing the target user's old password.

## Error paths

- **Wrong admin password**: The admin re-login at the end fails. The target user's password may have already been changed by step 4b — meaning a half-completed reset is possible. Operational note: this is a real failure mode.
- **Target user is the admin themselves**: Edge case. The flow may not handle this gracefully.
- **Admin email entered is not actually an admin**: The validation in step 4a should catch this and abort before any change occurs.

## Test implications

- Successful path: admin resets a target user; target user can log in with new password; admin is logged in at the end.
- Wrong-admin-password path: verify the partial-completion state and any rollback. If no rollback exists, this is a real bug worth filing.
- Audit: every reset action should produce a trail. Whether the platform produces this is not visible from the export — worth flagging.
