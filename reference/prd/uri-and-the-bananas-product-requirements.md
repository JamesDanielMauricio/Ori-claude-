---
title: "Uri and the Bananas — Product Requirements"
node_type: root
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A daily-shop trading platform for wholesale produce. Each trading day, the distributor initiates the cycle, growers submit their available pallets, customers place orders against grower supply, and the distributor matches supply to demand via arrangement records. The cycle terminates with the distributor closing the arrangement — at which point WhatsApp notifications go out, picks are locked, and the platform resets for the next day.

The full trading cycle is documented at [Daily Lifecycle](03_distributor/user_flows/daily_lifecycle.md).

## Roles

- **Admin** (מנהל מערכת) — system-level access across all companies. Equivalent to Distributor on the Backoffice UI (see Admin vs Distributor note below).
- **Distributor** (משווק) — runs the daily shop lifecycle and the arrangement matchmaking.
- **Grower** (מגדל) — submits daily picks of available produce.
- **Customer** (לקוח) — places orders during the open shop window.
- **Transporter** (מוביל) — **WhatsApp-only role**. Receives outbound notifications about the day's arrangement. **No in-app UI** — Transporters do not have a login destination or any role-specific surface in the platform.

## Role design notes (stakeholder-confirmed)

- **Transporter = WhatsApp-only.** The platform does not give Transporters a screen, a login destination, or interactive workflows. They are recipients of close-arrangement WhatsApp dispatches (see [WhatsApp Messaging](00_shared/integrations/whatsapp.md)) and nothing else. Any code that _suggests_ a Transporter UI is either dead or aspirational — confirmed with stakeholder. Tests should NOT assert a Transporter ever reaches an in-app screen.
- **Admin ≡ Distributor on the Backoffice.** The six management screens (Growers, Customers, Products, Users, Transporters, Distributor's customer-order views) make **no role distinction** between Admin and Distributor — verified by reading every `delete, edit, discard & save` reusable's element conditions. This is the intended design; Admin is currently a label, not a distinct permission set. If a future need for separation arises, it is a new feature, not a regression.
- **Order Status states beyond Submitted are aspirational placeholders.** The Order Status option set defines five states (Open / Submitted / Scheduled / Out for delivery / Received), but **no code path advances an order past Submitted** — verified by grep across every workflow in the export. Customer orders fulfilled by close-arrangement remain in **Submitted** status. The three later states are kept in the option set as forward-looking labels but are **not reachable today**. Code is the anchor: any UI that displays "Scheduled / Out for delivery / Received" is doing so by deriving from arrangement-record existence, not from the order's status field. Tests must not assert any order ever reaches one of those three states.

## Modules

- [Shared — Cross-Module Foundations](00_shared/_index.md) — components, state machines, integrations, and entities referenced by more than one role.
- [Grower Interface](01_grower/_index.md) — pick entry, pick lifecycle, out-of-stock propagation from supply.
- [Customer Interface](02_customer/_index.md) — order entry, order lifecycle, out-of-stock propagation from demand.
- [Distributor (Backoffice)](03_distributor/_index.md) — the four-phase trading lifecycle plus reference-data management.
- [Authentication, Password Reset, Profile](04_auth/_index.md) — sign-in and account management.

## Reading order

For a non-technical stakeholder coming in cold: read the root, then [Daily Lifecycle](03_distributor/user_flows/daily_lifecycle.md), then walk into each module's `_index.md`.

For a QA engineer authoring tests: each leaf node has a "Test implications" section — start with the user flows and business rules in each module.

For a developer hitting a specific area: every node's frontmatter has `source:` paths pointing to the original Bubble export — use those for ground truth verification.

## How this PRD was authored

This PRD was reverse-engineered from the unpacked Bubble export under the project root. Source paths in each node's frontmatter point at the specific export files the descriptions are derived from. The workflow methodology is captured in the [PRD-from-source skill](file:///Users/test/.claude/skills/prd-from-source/SKILL.md).

## Review status

- [REVIEW_ROUND_1.md](REVIEW_ROUND_1.md) — Round-1 review with three independent reviewers (PO / QA / Dev). Round signals: 2 SUBSTANTIAL FINDINGS + 1 DIMINISHING RETURNS. 36 findings; 21 ACCEPTED and applied; 13 DEFERRED to known gaps; 2 REJECTED with rationale.
- The Dev reviewer confirmed 16 specific PRD claims directly against the source files (full audit trail in the review file). **Source fidelity is solid.**
- Round 2 should be run before final sign-off. Expected to converge on diminishing returns within 1–2 more rounds based on the residual finding profile.

## Known gaps

Full tiered list at [KNOWN_GAPS.md](KNOWN_GAPS.md). Headline:

### Tier 1 — Blocking (4 items)

- Transporter role has no module. Either decompose or mark explicitly out-of-scope.
- Admin vs Distributor permission matrix on management screens unverified.
- Grower per-row popup chain (the actual pallet-entry surface) not decomposed.
- Customer order popup mechanics not decomposed.

### Tier 2 — Important (7 items)

- Submitted → Scheduled Order Status mechanism — `[INFERRED]`, may be unreachable in current code.
- Reset password partial-completion bug.
- `/reset_pw` page is non-functional (zero workflow actions).
- `delete_empty_order` caller and selection unspecified.
- Backoffice management transactional contract.
- ~15 utility backend workflows not decomposed individually.
- Two secondary entities (Alerts, Daily Shop Product).

### Tier 3 — Polish (5 items)

- Grower lockout SLA.
- Arrangement view layout sketch.
- Hebrew label sweep across screens.
- Day Status codes partially obfuscated.
- Reset_pass disabled workflows (code cleanup, not PRD scope).

## Security findings discovered during PRD authoring

These are real product bugs found by tracing code that has been live for ~1 year. They are NOT PRD gaps — they are findings about the running system. Flagged for stakeholder awareness:

1. **`/user_profile` change-password flow never validates the user's current password.** Action 2 of the `change pass` workflow uses a generated temporary password as the "Old Password" — the form's Current Password input is decorative. See [`04_auth/user_flows/edit_profile.md`](04_auth/user_flows/edit_profile.md).
2. **Plaintext password storage.** Action 3 of `change pass` writes the new password to a `created_pass_text` field on the User entity. Anyone with database read access to Users can read all current passwords. Same source.
3. **Half-completed reset on wrong admin password.** The admin-mediated reset changes the target user's password BEFORE authenticating the admin. A wrong admin password leaves the target's password permanently changed without any rollback. See [`04_auth/user_flows/reset_password.md`](04_auth/user_flows/reset_password.md).
4. **WhatsApp dispatch single-recipient email fallback to a personal address** (`bamapt@gmail.com`) with subject "Test Notification". See [`00_shared/integrations/whatsapp.md`](00_shared/integrations/whatsapp.md).
5. **All WhatsApp workflows bypass privacy entirely.** Cross-company message routing has no privacy-layer safety net. Same source.
6. **`close_arrangement` is not idempotent.** Pressing the button twice resends WhatsApp messages and creates a duplicate Session record. See [`03_distributor/backend_flows/close_arrangement.md`](03_distributor/backend_flows/close_arrangement.md).
7. **`initiate_business_day` has no guard against mid-cycle re-invoke.** Pressing the button while a previous day is still active silently abandons that day's records. See [`03_distributor/backend_flows/initiate_business_day.md`](03_distributor/backend_flows/initiate_business_day.md).
8. **`save_order_line` dash-split parsing corrupts comments containing `-`.** See [`02_customer/backend_flows/save_order_line.md`](02_customer/backend_flows/save_order_line.md).

These findings emerged because the PRD authoring process traced code paths rather than asking humans. Recommend triage with the team that owns the platform.
