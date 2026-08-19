---
title: "Known Gaps"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The triaged list after all phases of `prd-review` completed, including Phase 3 code-extraction, Phase 4 bug-routing, and the stakeholder answers from 2026-05-15.

**Status: all 16 items closed.** The PRD is materially complete.

**Status legend:**

- ✅ **RESOLVED** — answered (by code, stakeholder, or accepted-as-edge-case); PRD nodes updated.
- 🐛 **FILED AS DEV TASK** — real product bug, tracked in the platform's Kanban.

---

## Tier 1

### G1. Transporter role — ✅ RESOLVED (stakeholder)

WhatsApp-only role. No in-app UI. Documented in root `_index.md`, `00_shared/entities/user.md`, `04_auth/business_rules/role_based_routing.md`.

### G2. Admin vs Distributor permission matrix — ✅ RESOLVED (stakeholder + code)

Identical permissions, by design. Documented in [`management_screens.md`](03_distributor/screens/backoffice/management_screens.md).

### G3. Grower per-row popup chain — ✅ RESOLVED (code)

Decomposed. Pallet entry is INLINE in the row (corrected earlier misreading). Five row popups documented at [`row_popups.md`](01_grower/screens/grower_home/row_popups.md); only Popup A copy 5 (the comment editor) accepts input.

### G4. Customer order popup mechanics — ✅ RESOLVED (code)

Only one popup exists in `customer_order_interface_v2` — the comment confirmation popup at [`comment_popup.md`](02_customer/screens/customer_home/comment_popup.md). Order entry is otherwise inline.

---

## Tier 2

### G5. Order Status states beyond Submitted — ✅ RESOLVED (stakeholder)

Aspirational placeholders; code is the anchor. Documented in [`00_shared/state_machines/order_status.md`](00_shared/state_machines/order_status.md) and [`02_customer/business_rules/order_status_transitions.md`](02_customer/business_rules/order_status_transitions.md).

### G6. Reset password partial completion — 🐛 FILED AS DEV TASK `c1340f68-4f88-4f55-b8a2-d9a803642d96`

### G7. /reset_pw non-functional — 🐛 FILED AS DEV TASK `3931d474` (pre-existing)

### G8. delete_empty_order caller — ✅ RESOLVED (code)

Caller: `daily check for empty orders` (cron sweep). New PRD node at [`daily_check_empty_orders.md`](03_distributor/backend_flows/daily_check_empty_orders.md).

### G9. Backoffice management transactional contract — ✅ RESOLVED (code)

No transactional boundary. Multi-step saves can leave inconsistent state if a workflow fails mid-way. Documented in [`management_screens.md`](03_distributor/screens/backoffice/management_screens.md).

### G10. Utility backend workflows — ✅ RESOLVED (priority subset)

Four new nodes for the high-value workflows:

- [`create_pick_product_lines.md`](01_grower/backend_flows/create_pick_product_lines.md) — `create_daily_pick_product_datas`. Documents the dual real+temp record creation; confirms rerun preserves pallet counts.
- [`leftover_pipeline.md`](01_grower/backend_flows/leftover_pipeline.md) — covers the three confusingly-named leftover workflows.
- [`populate_prices.md`](03_distributor/backend_flows/populate_prices.md) — final pricing step of close_arrangement.
- [`daily_check_empty_orders.md`](03_distributor/backend_flows/daily_check_empty_orders.md) — cron sweep.

Remaining utility workflows (Boolean / date / manifest / xz / fill_* / get_* / sign-the-user-up / etc.) are narrow helpers covered conceptually by their callers' nodes. Authoring per-workflow nodes for them is low-value busywork — would only be needed if a specific test/audit references them.

### G11. Secondary entities — ✅ RESOLVED (code)

[`daily_shop_product.md`](00_shared/entities/daily_shop_product.md) + [`alerts.md`](00_shared/entities/alerts.md).

---

## Tier 3

### G12. Grower lockout — ✅ RESOLVED (stakeholder — accepted edge case)

**Stakeholder confirmation:** the "grower lands on home with no Daily Pick for today" scenario is an **edge case that would never realistically occur** — the platform is a private business-specific app where the grower's company maintains direct WhatsApp/phone contact with the distributor. A missing-day-initiation is resolved informally outside the app. **No in-product remediation, no formal SLA, no in-app remediation button.** This is accepted operational behavior, not a gap.

**PRD update applied:** [`01_grower/user_flows/submit_pick.md`](01_grower/user_flows/submit_pick.md) — the error path section now states this explicitly.

### G13. Arrangement view layout sketch — ✅ RESOLVED (code)

Conceptual ASCII layout in [`arrangement_view.md`](03_distributor/screens/backoffice/arrangement_view.md).

### G14. Hebrew label sweep — ✅ RESOLVED (won't-do: out of scope for business-specific app)

**Reframing:** the platform is a Hebrew-only private business app, not a SaaS. There is no localization or translation rigor target. The Hebrew labels already in the PRD (state machines, key UI strings) are the ones tests will anchor on; an exhaustive verbatim sweep across every screen file would be mechanical busywork with no consumer.

If a specific test ever needs a string that's not already in the PRD, the test authoring agent can grep the source file directly — that's a faster path than maintaining a comprehensive label inventory in the PRD.

### G15. Day Status codes — ✅ RESOLVED (code)

Two values (`open`, `closed`). Documented.

### G16. Reset_pass disabled workflows — ✅ RESOLVED (Out of PRD scope)

Code-cleanup ticket, not a PRD concern.

---

## Final summary

| Status               | Count                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| ✅ RESOLVED (in PRD) | 14 of 16                                                                                         |
| 🐛 FILED AS DEV TASK | 2 (G6, G7) — plus 8 unique new tasks from Phase 4 (see [SESSION_SUMMARY.md](SESSION_SUMMARY.md)) |
| ❓ Open              | **0**                                                                                            |

**The PRD is complete.** No remaining stakeholder questions. No deferred decomposition. Every Tier 1 / Tier 2 / Tier 3 item has a resolution. The 9 dev tasks (8 new + 1 pre-existing) are in eng's Kanban for fix-cycle ownership.
