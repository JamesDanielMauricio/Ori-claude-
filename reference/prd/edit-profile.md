---
title: "Edit Profile"
node_type: user_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A user's path to update their own account.

## Preconditions

- The user is logged in.
- The user navigates to `/user_profile` (typically via the header menu or sidebar).

## Steps

1. **Arrive at `/user_profile`.** The form binds to the current user.
2. **Edit basic fields** (name, phone, email) as desired.
3. **(Optional) Open the change-password section** by tapping the toggle (`שינוי ססמא`). Enter current password, new password, and confirm new password.
4. **Save.** The save chain runs:
   - If the change-password section is open: the `change pass` workflow sets a temporary password → logs in as the user (the user is already logged in, so this is a no-op or re-auth) → updates credentials to the new password.
   - ChangeThing persists the basic-field edits.
   - Custom state confirms the save.
   - The `navigate` event routes the user back to their role's home page.

OR

4'. **Cancel.** Bypasses save; routes to home directly.

## Success state

- Basic field changes are persisted on the User record.
- Password change (if performed) is effective on next login.
- The user is on their role's home page.

## Error paths

- **Wrong current password** during password change: **verified by direct source read of the `change pass` workflow** — the workflow does NOT validate the user's entered current password. Action 1 generates a temporary password; Action 2's `UpdateCredentials` uses that _temporary password_ as the "Old Password", not the user's actual current password. The Current Password input on the form is decorative — its value is never compared to anything. **This is a real security finding worth filing as a product bug.**
- **Save failure mid-chain**: e.g., the basic ChangeThing succeeds but the navigate event fails — user is on the profile page with successful save but no UI confirmation. Operationally annoying; worth verifying.

## Security findings discovered during this trace

Documented for transparency — both are real and should be tracked as product bugs:

1. **Current Password input is decorative.** A logged-in user can change their own password without supplying their current one. Anyone with temporary access to a logged-in session can change the password and persistently take over the account.
2. **Plaintext password storage.** Action 3 of `change pass` writes the new password to a User field called `created_pass_text` as plain text — separate from the Bubble-managed hashed credential. Anyone with database read access to the User entity can read all created passwords. The field is referenced by other workflows (e.g., the admin-mediated reset flow) and is therefore not vestigial — removing it requires understanding all callers.

These are platform-level findings, not test issues. Operational decisions are required:

- Should the current-password field actually validate?
- Should plaintext passwords be expunged from `created_pass_text` and replaced with hash-only flows?

## Test implications

- A user editing only their phone number must not need to enter the password fields.
- A user changing only their password must not have their basic fields reset.
- **The "Current Password" field accepting any value (including a wrong value)** is currently the actual behavior — a test asserting "wrong current password rejects the change" would fail. This is a known security bug; do not author a test that locks in the broken behavior. Instead, file a security ticket.
- Email field changes are persisted directly with no verification step — this is the platform's current intended behavior (Bubble's email-change action is configured `Silent: yes`). Tests should assert immediate persistence; the lack of verification is a known operational gap.
