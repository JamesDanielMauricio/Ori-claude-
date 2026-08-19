---
title: "User Profile"
node_type: screen
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A single page where an authenticated user reviews and edits their account fields. The page binds to `Current User` — the user can only edit their own record.

## Visible fields

| Field        | Hebrew label          | Editable       |
| ------------ | --------------------- | -------------- |
| First name   | (label not extracted) | yes            |
| Last name    | (label not extracted) | yes            |
| Email        | אימייל                | yes (required) |
| Phone number | (label not extracted) | yes            |

## Change-password subsection (toggle)

A separate area opens when the user taps the "Change Password" toggle (`שינוי ססמא`). When open, three additional fields appear:

| Field                | Hebrew label    |
| -------------------- | --------------- |
| Current password     | ססמא נוכחית     |
| New password         | ססמא חדשה       |
| Confirm new password | אישור ססמא חדשה |

The toggle is driven by a custom state `change_pass__`. Two workflows handle the toggle (open/close).

## Save action

Pressing **Save** triggers four actions:

1. **`change pass` custom event** — runs only if the change-password section is open and the user entered new password values. The event:
   - Sets a temporary password.
   - Updates credentials to the new password.
   - Persists the change.
   - Resets inputs.
   - Closes the change-password section.
2. **ChangeThing on Current User** — saves the basic field edits (name, phone, email).
3. **Custom state update** — confirms the save in the UI.
4. **`navigate` custom event** — routes the user back to their role's home page (Grower / Customer / Backoffice).

## Cancel

A Cancel button triggers `navigate` only, bypassing the save. The user lands back on their home page with no changes.

## Role-conditional behavior

The page is **not** role-gated as strictly as other pages — any authenticated user can reach `/user_profile` regardless of role. The post-save navigation routes by role (per [Role-Based Routing](../business_rules/role_based_routing.md)).

## Test implications

- A user editing only basic fields (no password change) must NOT inadvertently trigger the password-change flow.
- A user changing only their password must NOT have basic fields reset to defaults.
- After save, the user must land on their role's home — not on the profile page itself (which would suggest the navigate event failed).
- Email changes are persisted directly — there is no email-verification step visible in this flow. Worth flagging operationally: a user can change their own email to anything.
