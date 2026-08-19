---
title: "Authentication, Password Reset, and Profile"
node_type: module
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The unauthenticated entry surface. Five pages:

- **`/login`** — email + password sign-in. The platform's only unauthenticated entry point.
- **`/reset_pass`** — the primary password-reset page (active version). Admin-mediated reset flow that requires an admin credential.
- **`/reset_pw`** — a simplified password-reset card. Likely the user-facing version triggered from a reset email link with a token.
- **`/user_profile`** — view and edit account fields, including a "change password" subsection.
- **`/404`** — generic not-found page.

Every other module's access guard redirects unauthenticated users here. Successful login from `/login` routes the user to their role's home page (Grower / Customer / Backoffice).

## Children

- Screens
  - [Login](screens/login.md)
  - [Reset Password (primary)](screens/reset_pass.md)
  - [User Profile](screens/user_profile.md)
- User flows
  - [Sign In](user_flows/sign_in.md)
  - [Reset Password](user_flows/reset_password.md)
  - [Edit Profile](user_flows/edit_profile.md)
- Backend flows
  - [Assign Temporary Password](backend_flows/assign_temp_pass.md)
- Business rules
  - [Role-Based Routing](business_rules/role_based_routing.md) — the post-login navigation rules

## Notes

The auth pages do NOT mount the header menu or sidebar (those are for authenticated pages). The `Signup_Login` reusable provides its own minimal layout.

The `/404` page is trivial (a static "page not found") and is not decomposed in this PRD.

The `/reset_pw` page is a stripped variant of `/reset_pass`. It is described only briefly in [Reset Password](screens/reset_pass.md) since the two pages share a flow — the question of which one is the canonical entry point for end-users vs admin-mediated resets is captured there.
