---
title: "User"
node_type: entity
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The authenticated actor. Identified by email + password. Belongs to exactly one Company.

## Key fields (business meaning only)

| Field        | Type                | Notes                                                                                                                              |
| ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| First Name   | text                | Used in greetings ("שלום [First Name]").                                                                                           |
| Last Name    | text                | Optional.                                                                                                                          |
| Email        | text                | The login identity. Unique across the platform.                                                                                    |
| Phone Number | text                | Used for WhatsApp dispatch when the user's Company has no group ID. Israeli format.                                                |
| Password     | (hashed)            | Bubble-managed. The `Signup_Login` reusable element handles auth.                                                                  |
| Role         | option:User Roles   | One of: Admin, Distributor (משווק), Grower (מגדל), Customer (לקוח), Transporter (מוביל). See the role table below.                 |
| Company      | reference → Company | The tenant the user belongs to.                                                                                                    |
| Temp Pass    | text                | A temporary password set during the password-reset flow (see [assign_temp_pass](../../04_auth/backend_flows/assign_temp_pass.md)). |

## Roles

| Role code   | Label (he) | Access surface                                                                                                                                                                                                                                                   |
| ----------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin       | מנהל מערכת | Full Backoffice access; system-level changes.                                                                                                                                                                                                                    |
| Distributor | משווק      | Backoffice — runs the daily lifecycle (open shop, close shop, close arrangement).                                                                                                                                                                                |
| Grower      | מגדל       | Grower Home — declares daily picks.                                                                                                                                                                                                                              |
| Customer    | לקוח       | Customer Home — places daily orders.                                                                                                                                                                                                                             |
| Transporter | מוביל      | **WhatsApp-only role — no in-app UI.** Receives outbound notifications when the Distributor closes the day's arrangement. Does not have a login destination. Stakeholder-confirmed: aspirational entries that suggest a Transporter UI are dead or aspirational. |

Role is **the** gate on which page a user lands and which actions they can take. Per-page guards enforce role before any content renders — see [Page Data-Popup Pattern](../components/page_shell/_index.md).

## Authentication

Login is via the `Signup_Login` reusable on the `/login` page. Successful login routes the user by role:

- Admin or Distributor → `/backoffice`.
- Grower → `/grower_interface`.
- Customer → `/customer_interface`.
- Transporter → **dead route**. The `navigate` event has no Transporter branch (or has one that points to a non-functional destination). A Transporter who somehow obtains login credentials will get stranded on the login page after authentication. This is the design — Transporters are not platform users in the interactive sense.

## Test implications

- A user without a Company link (e.g., partially-created record) would fail every visibility check that reduces to "your company matches" — tests should never use such a user.
- Changing a user's Role mid-session must result in the next page render hitting the wrong-role guard and signing them out. Tests can verify this by an Admin demoting another user and confirming the demoted user is logged out on their next interaction.
