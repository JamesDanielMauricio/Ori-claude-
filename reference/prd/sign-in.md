---
title: "Sign In"
node_type: user_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The platform's primary entry flow.

## Preconditions

- The user has a valid account in the platform (User entity exists, has a role and a company link).
- The user knows their email and password.

## Steps

1. **Arrive at `/login`.** Either directly, or via a redirect from any authenticated page's access guard.
2. **Enter credentials.** Email, password. Toggle "Remember me" as desired (defaults to enabled).
3. **Submit.** Press the login button.
4. **System authenticates.** Bubble's `LogIn` action validates credentials.
5. **Route by role.** A `navigate` custom event runs through role checks and `ChangePage`s the user to:
   - Admin or Distributor → `/backoffice`.
   - Grower → `/grower_interface`.
   - Customer → `/customer_interface`.
   - Transporter → (destination not fully decomposed — likely a transporter-specific page or a sub-tab of backoffice).

## Success state

The user is on their role's home page, fully authenticated. Subsequent navigation works as normal.

## Error paths

- **Wrong credentials**: The platform surfaces a default authentication error. The user remains on `/login`.
- **Account doesn't exist**: Same as wrong credentials — no enumeration leak.
- **Account exists but no role**: Edge case. Likely the navigate workflow's role branches all fail and the user is left stranded. Worth flagging as a data-integrity test (every User should have a role).

## Test implications

- Each role × correct password must route to the correct home page.
- Wrong password must not route and must surface a visible error.
- A logged-in user pasting `/login` directly: behavior should be sensible (either redirect to their home or allow re-login). Verify and document.
