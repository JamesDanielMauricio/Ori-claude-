---
title: "Distributor Access Gating"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Two access checks run on the Backoffice page at load time. Same shape as the Grower and Customer guards, but the role check accepts **two** roles.

## Rule 1 — Authentication required

If the current user is **not logged in**, the screen redirects to login.

## Rule 2 — Role must be Distributor OR Admin

If the current user is logged in but is **not** a Distributor or Admin (i.e., they are Grower, Customer, Transporter, or any future role), the screen **signs them out** and redirects to login.

## Per-screen further gating

The Backoffice page is the union of Distributor and Admin surfaces, but individual sub-screens may further restrict — e.g., role/permission management might be Admin-only. These finer-grained rules live inside each management screen's element conditions and need decomposition once those reusables are walked.

## Test implications

- An unauthenticated visitor to the backoffice URL must land on login.
- A Grower, Customer, or Transporter pasting the backoffice URL must be signed out.
- Both Distributors and Admins must successfully reach the page.
- A test that demotes an Admin to Grower mid-session should result in the user being signed out on next page render.
