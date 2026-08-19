---
title: "Login"
node_type: screen
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A minimal page hosting the `Signup_Login` reusable element. No header, no sidebar — the user is unauthenticated and the platform's standard chrome doesn't apply yet.

## Form

| Field       | Type               | Notes                                                                                   |
| ----------- | ------------------ | --------------------------------------------------------------------------------------- |
| Email       | text, required     | The user's account email.                                                               |
| Password    | password, required | Hidden by default; a show/hide toggle is available (via `show_hide password` reusable). |
| Remember me | checkbox           | Defaults to enabled. Persists the session on this device.                               |

## Submit

Pressing the submit button triggers the platform's `LogIn` action with the entered credentials. On success:

- The session is started.
- A `navigate` custom event is triggered, which branches by role and routes the user to their home page — see [Role-Based Routing](../business_rules/role_based_routing.md).

On failure (wrong credentials, locked account):

- The platform surfaces a default authentication error (Bubble-managed). The exact copy is not customized. The platform's primary language is Hebrew (`language: he` at the root), so tests should pin their browser locale to `he` and assert the Hebrew default error text — non-Hebrew browser locales would surface different default messages and produce non-deterministic test failures.

## Hebrew labels

The form labels are in Hebrew (אימייל / Email, etc.) but the exact strings need verification from the `Signup_Login` reusable's element internals — not decomposed in this PRD pass.

## Test implications

- Successful sign-in must route to the correct home page based on role. A test matrix should cover each role × correct credentials.
- Wrong credentials must NOT route — the user stays on the login page with the error surfaced.
- "Remember me" checkbox state should persist across page reloads on the same device.
