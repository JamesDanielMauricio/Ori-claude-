---
title: "Grower Access Gating"
node_type: business_rule
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Two access checks run on the Grower Home screen at load time.

## Rule 1 — Authentication required

If the current user is **not logged in**, the screen redirects to the login page. No grower data renders.

## Rule 2 — Role must be Grower

If the current user is **logged in but not a Grower** (Customer, Distributor, Transporter, Admin, or any future role), the screen **signs them out** and redirects to the login page. They cannot view the grower home, even read-only.

## Why both checks live on the page

Authentication is enforced everywhere by login redirects, but the role check is intentionally on this screen — to prevent (for example) a Distributor who pastes a grower URL from getting a grower-shaped view. Signing them out is a deliberate hard reset rather than a softer "wrong role" banner.

## Test implications

- An unauthenticated visitor to the grower URL must land on login, never on a blank or partially-rendered grower page.
- A Customer or Distributor pasting the grower URL must be signed out **and** redirected.
- A Grower from any company must successfully reach the screen — the gate is on role, not company. Company scoping happens at the data layer (see [Pick Visibility](pick_visibility.md)).
