---
title: "Assign Temporary Password"
node_type: backend_flow
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A small workflow used inside the admin-mediated reset flow. Runs with privacy bypassed.

> **Verified against local source 2026-05-15:** the workflow files `Backend Workflows/assign_temp_pass/1. SetTemporaryPassword.md` and `2. ChangeThing.md` are present in the local export. A QA dev-task (`f1555c6b`) referenced a separate closed dev_task `3c13229e` claiming this workflow was removed, but the local source contradicts that claim. If the runtime state differs from the local export, that's a separate export-sync question, not a PRD issue.

## Inputs

- `user` — the User record to receive a temporary password.

## Actions (2)

1. **SetTemporaryPassword** — Bubble's built-in action that generates a random password and binds it transiently to the user. The result of this step is the generated password.
2. **ChangeThing** — Stores the step-1 result in the user's `temp_pass_text` field for later reference (used by the calling workflow to log in as the user).

## Why temp_pass_text is stored on the user

The reset flow needs to:

1. Generate a temp password.
2. Log in as the user using that temp password.
3. Update the user's credentials.

Between steps 1 and 2, the temp password must be accessible to the calling code. Storing it on the user record (in `temp_pass_text`) is the Bubble-native way to pass it through. After the flow completes, the field may still hold the temp password — operationally this is a minor concern (the temp password is now invalid because credentials were updated, but the value persists in the database).

## Privacy

`Ignores Privacy: yes`. Required because the workflow operates on a user record the caller may not have write privilege over.

## Operational concern — temp_pass_text persistence

After the reset completes, the platform does NOT clear `temp_pass_text` on the user record. The temp password value remains in the database. While the password itself is now invalid as a credential (because Action 4 of the calling reset flow has updated the user's actual credentials), the value is still readable by anyone with database access to the User entity.

This is classified as a **known operational concern**, not a bug — it reflects the platform's intentional behavior. Decisions are required:

- Should `temp_pass_text` be cleared at the end of every reset flow?
- Should the field be removed entirely if it's only used as a workflow-internal carry?

## Test implications

- A test of the reset flow should verify `temp_pass_text` is populated immediately after this workflow runs.
- After the reset completes, the temp password should no longer be usable as a real credential (it was overwritten by the new password). Verify by attempting to log in with the temp password value after the flow.
- A test asserting "temp_pass_text is empty after reset" would currently FAIL — that's the known operational state. Do not write a test that locks in either direction; file a security ticket if cleanup is desired.
