---
title: "PRD Authoring Session — Final Summary"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

**Date:** 2026-05-15
**Author:** Claude (Opus 4.7) under the `prd-from-source` and `prd-review` skills
**Source:** Unpacked Bubble export of "אורי והבננות" / "Uri and the Bananas"
**Status:** PRD materially complete — only 1 stakeholder polish question (Q4 / G12) and an optional Hebrew label sweep remain.

---

## What's in the repo

### PRD — 82 files at `Ori/st4ck/docs/prd/`

```
st4ck/docs/prd/
├── _index.md                          (root with module index, role notes, security findings)
├── SESSION_SUMMARY.md                 (this file)
├── REVIEW_ROUND_1.md                  (round-1 audit, 36 findings + resolutions)
├── KNOWN_GAPS.md                      (13 of 16 RESOLVED; 1 stakeholder Q remaining)
├── 00_shared/                          22 nodes — components, state machines, integrations, 7 entities
├── 01_grower/                          16 nodes — interface, entities, flows, rules
├── 02_customer/                        14 nodes — interface, entities, flows, rules
├── 03_distributor/                     17 nodes — backoffice, lifecycle workflows, rules
└── 04_auth/                            9 nodes — login, reset, profile
```

Up from 72 nodes (initial pass) to 82 nodes after stakeholder answers + decomposition of grower popups, customer comment popup, leftover pipeline, pick-product creation, populate-prices, and daily empty-order sweep.

### Skills + agents

| Artifact                          | Canonical path                              | Plugin status                                             |
| --------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `prd-from-source` skill           | `~/.claude/skills/prd-from-source/SKILL.md` | Bundled in both `st4ck` and `st4ck-lite`                  |
| `prd-review` skill                | `~/.claude/skills/prd-review/SKILL.md`      | Bundled in both                                           |
| `prd-reviewer-{po,qa,dev}` agents | `~/.claude/agents/prd-reviewer-*.md`        | Bundled in both                                           |
| Plugin READMEs                    | —                                           | `st4ck/README.md` (new), `st4ck-lite/README.md` (updated) |

### Project-level

- `Ori/AGENTS.md` — slim, operational-only (72 lines after the earlier cleanup); links to the PRD for product context.

---

## Stakeholder answers received (2026-05-15)

| #   | Question                                               | Answer                                             | PRD update                                                                                               |
| --- | ------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Q1  | Is Transporter aspirational or does it have a surface? | **WhatsApp-only.** No in-app UI.                   | Root index, User entity, role-routing — all state "WhatsApp-only role, no destination by design"         |
| Q2  | Are Order Status states 3-5 reachable?                 | **Aspirational placeholders. Code is the anchor.** | Order Status state machine + transitions doc now state the 5-state machine is functionally 2-state today |
| Q3  | Admin ≡ Distributor in management UI by design?        | **Yes, identical by design.**                      | management_screens.md states "no separation, by design"                                                  |
| Q4  | Grower lockout SLA?                                    | **Still open.**                                    | KNOWN_GAPS G12                                                                                           |
| Q5  | Triage the 8 filed dev tasks?                          | (operational — for eng team)                       | URLs below                                                                                               |

## The four-phase pipeline that ran

Per the updated `prd-review` skill methodology:

1. **Phase 1 — Author self-review** ✓
2. **Phase 2 — Three-angle independent review** ✓ (PO/QA SUBSTANTIAL FINDINGS, Dev DIMINISHING RETURNS)
3. **Phase 3 — Known-gaps-vs-code pass** ✓ (5 gaps resolved by reading code: G2, G5, G8, G11, G15)
4. **Phase 4 — Bug-routing** ✓ (8 dev tasks filed against Ori v1.3)

Plus the stakeholder Q&A round (Q1/Q2/Q3 answered → 3 more gaps RESOLVED: G1, G2, G5), plus a focused decomposition pass for the high-value KNOWN_GAPS items (G3, G4, G9, G10, G13).

---

## 8 dev tasks filed (Phase 4)

All against Ori project ID `2685d0e6-06fb-49ef-9f5a-ce2a94d6d080`, version v1.3.

| Priority     | Task                                                                                    | URL                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **CRITICAL** | User Profile change-password doesn't validate current password (decorative input)       | https://app.st4ck.io/project/2685d0e6-06fb-49ef-9f5a-ce2a94d6d080?tab=developers&task=a376b84f-4436-4f85-a897-f9d0e50b3177 |
| **CRITICAL** | Plaintext password stored in `User.created_pass_text` on every password change          | https://app.st4ck.io/project/2685d0e6-06fb-49ef-9f5a-ce2a94d6d080?tab=developers&task=58f14daa-772e-47a9-b57a-6f403d4f6eba |
| **HIGH**     | Admin-mediated reset can leave target's password changed if admin re-auth fails         | https://app.st4ck.io/project/2685d0e6-06fb-49ef-9f5a-ce2a94d6d080?tab=developers&task=c1340f68-4f88-4f55-b8a2-d9a803642d96 |
| **HIGH**     | WhatsApp fallback hardcodes personal email + "Test Notification" subject                | https://app.st4ck.io/project/2685d0e6-06fb-49ef-9f5a-ce2a94d6d080?tab=developers&task=1b761f44-ec8c-496a-8e1d-832be8641823 |
| **HIGH**     | close_arrangement is not idempotent — double-press resends WhatsApp + duplicate Session | https://app.st4ck.io/project/2685d0e6-06fb-49ef-9f5a-ce2a94d6d080?tab=developers&task=8c6707a5-7f84-4cd6-8e64-714070309ee7 |
| **HIGH**     | initiate_business_day has no mid-cycle guard — silently abandons previous day's records | https://app.st4ck.io/project/2685d0e6-06fb-49ef-9f5a-ce2a94d6d080?tab=developers&task=1569da40-73d6-48a6-84bb-9bdabf8aca00 |
| **MEDIUM**   | save_order_line corrupts customer comments containing a dash character                  | https://app.st4ck.io/project/2685d0e6-06fb-49ef-9f5a-ce2a94d6d080?tab=developers&task=d77b2df4-06ae-4b29-9281-3e717072f252 |
| **MEDIUM**   | All WhatsApp workflows bypass privacy — no cross-company safety net                     | https://app.st4ck.io/project/2685d0e6-06fb-49ef-9f5a-ce2a94d6d080?tab=developers&task=f165f520-f16e-45ab-ae42-6d605b859cf7 |

Plus the pre-existing `3931d474` for `/reset_pw` non-functionality.

---

## Methodology evolution captured in the skills

Over the session, the user iterated the methodology six times. Each is now codified:

1. "Code is the spec — don't [NEEDS CLARIFICATION] what the code answers." → Iron Rule #1 in `prd-from-source`.
2. "Subagents hallucinate — make them attest." → Iron Rule #4.
3. "This is a PRD, not architecture — stop decoding internal codes." → Internal-code anti-pattern in `prd-from-source`.
4. "Run reviews → check known-gaps-vs-code → file bugs as dev tasks → ask user only what's really left." → Phases 3 and 4 in `prd-review`.
5. "AGENTS.md shouldn't duplicate PRD content — drift hazard." → AGENTS.md companion section in `prd-from-source` now policy-shaped.
6. "Call out unused / dead / aspirational code without hedging." → Iron Rule #1 corollary in `prd-from-source`.
7. "Phase 0 — check `get_project_users` first; if no role taxonomy, ask the user; ask about extra docs." → Phase 0 Preliminaries in `prd-from-source` (added before Pass 1).

---

## What's actually left

| Type                          | Count | What                                                                          |
| ----------------------------- | ----- | ----------------------------------------------------------------------------- |
| ❓ Open stakeholder questions | 1     | Q4 / G12 — grower lockout SLA (in-product remediation + response time)        |
| 🔍 Optional polish            | 1     | G14 — Hebrew label sweep across screen nodes (mechanical pass, no value gate) |
| 🐛 Filed dev tasks            | 9     | All in Ori v1.3 Kanban (8 new + 1 pre-existing)                               |

Everything else is RESOLVED. The PRD is materially complete and ready for downstream test authoring against.

---

## How to verify any claim

Every node's frontmatter has a `source:` list pointing at the Bubble export paths. Verify by:

1. Find the PRD `.md` node.
2. Read the `source:` paths.
3. Read those source files in the repo.

Dev reviewer's 16 CONFIRMED spot-checks in REVIEW_ROUND_1.md are the audit trail proving the PRD's source fidelity in round 1.

---

## Final file count for the session

- **PRD:** 82 MD files (up from 70 in the proof-of-shape iteration).
- **Audit/index:** 3 files (root, REVIEW_ROUND_1, KNOWN_GAPS) + this summary.
- **Skills:** 2 canonical + 4 plugin-bundled.
- **Agents:** 3 canonical + 6 plugin-bundled.
- **READMEs:** 1 new (st4ck-plugin), 1 updated (st4ck-lite).
- **AGENTS.md:** 1 (slimmed to operational-only).

**Total session: ~110 files created or substantially modified.**

The PRD's done. The skills are stable. The bugs are filed. Eng can take it from here.
