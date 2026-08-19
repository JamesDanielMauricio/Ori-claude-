---
title: "Customer Access Gating"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Two access checks run on the Customer Home screen at load time. Same shape as the equivalent grower guard.

## Rule 1 — Authentication required

If the current user is **not logged in**, the screen redirects to the login page. No customer data renders.

## Rule 2 — Role must be Customer

If the current user is **logged in but not a Customer** (Grower, Distributor, Transporter, Admin, or any future role), the screen **signs them out** and redirects to the login page.

This is a hard reset, not a soft "wrong role" banner — by symmetry with grower access gating.

## Additional guard — parameter mismatch

A third condition on this page handles deep-link mismatches: if the URL parameter `data` points to a Daily Order whose customer-company does NOT match the current user's company AND the user is not in a **privileged role** (Distributor or Admin), the screen reloads itself (effectively a soft reject). This protects against URL guessing — a customer pasting another company's order URL gets bounced, while a Distributor or Admin can legitimately deep-link into any customer's order.

## Test implications

- An unauthenticated visitor to the customer URL must land on login.
- A Grower or Distributor pasting the customer URL must be signed out.
- A Customer from Company A pasting a Company B order's URL must be rejected (without exposing whether the URL was valid).
