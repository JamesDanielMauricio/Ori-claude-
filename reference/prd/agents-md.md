---
title: "AGENTS.md"
node_type: component
source: st4ck PRD (Ori and the Bananas), environment=staging
---

Repo-operational steering for AI agents working in this directory. Follows the [agents.md](https://agents.md/) convention.

**This file does NOT describe the product.** For everything about _what the system does_ — entities, flows, business rules, state machines, security findings, known issues — read the PRD at [`st4ck/docs/prd/_index.md`](./st4ck/docs/prd/_index.md). Keeping product context in the PRD and operational steering here avoids drift between two files that would otherwise carry overlapping truth.

---

## What's in this directory

| Path                 | Contents                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Pages/`             | Unpacked Bubble pages. One folder per page. `.md` (human-readable) + `.meta.json` (raw Bubble JSON) per element. |
| `Data Types/`        | Bubble data type definitions.                                                                                    |
| `Backend Workflows/` | Server-side workflows (API events + database triggers).                                                          |
| `Option Sets/`       | Enumerations and state-machine values.                                                                           |
| `Reusable Elements/` | Bubble reusable UI components.                                                                                   |
| `Styles/`            | Style definitions.                                                                                               |
| `st4ck/docs/prd/`    | **The PRD — start here for product context.**                                                                    |
| `*.bubble`           | Original Bubble export archives. The unpacker produced everything else from these.                               |

## Reading the source

Each unpacked Bubble artifact is a pair of files:

- `<Name>.md` — human-readable description with YAML frontmatter.
- `<Name>.meta.json` — raw Bubble JSON.

**The `.md` summary can drop detail that's only in the `.meta.json`** — list operators (`add` / `remove` / `set`), condition values for option-set references, and obfuscated `db_value` strings. When ground truth matters, read both. The PRD's source-fidelity rules explain when this matters.

## Working conventions

### Always

- **Consult the PRD first** for any question about what the platform does. The PRD is the single source of product truth.
- **Read the source before claiming behavior.** Comments and `.md` summaries can be incomplete; the `.meta.json` is authoritative for operators and conditions.
- **Cite source paths for non-trivial claims** when authoring docs or reasoning about code.

### Ask first

- Any change to the four trading-day lifecycle workflows (see the PRD's Distributor module).
- Any change to privacy rules on data types.
- Any change to the WhatsApp integration paths or fallback configuration.
- Removing or renaming any field on `App Settings`.

### Never

- Use service-role credentials for user-scoped operations in new code paths (the global rule from `~/.claude/CLAUDE.md` applies).
- Treat the existing PRD nodes in the st4ck database as authoritative — those are from failed prior attempts. The canonical PRD is the file-based one under `st4ck/docs/prd/`.

## Tooling — what's wired up

- **MCP servers** for live database queries: `st4ck-dev` exposes `bubble_get_schema`, `bubble_list_records`, `supabase_query`, etc. Use these when an export ambiguity blocks progress.
- **Skills** available for working with the PRD:
  - `prd-from-source` — author or extend PRD nodes by reading source.
  - `prd-review` — run the four-phase review loop (self-review → 3 parallel reviewers → known-gaps-vs-code → bug routing).
- **Subagent types** for reviews: `prd-reviewer-po`, `prd-reviewer-qa`, `prd-reviewer-dev`.

## Build / test / run

This is a Bubble project — there is no local build pipeline for the application itself. Changes to the live app are made through the Bubble editor at bubble.io. The unpacked export here is the source-of-truth artifact for AI agents reasoning about the platform.

For st4ck infrastructure (QA test cases, components, etc.), see the st4ck server documentation.

## Where the product context lives

Everything else — roles, lifecycle, state machines, dead code, security findings, known gaps, stakeholder questions — is in the PRD. Start with:

- [`st4ck/docs/prd/_index.md`](./st4ck/docs/prd/_index.md) — root, review status, security findings.
- [`st4ck/docs/prd/KNOWN_GAPS.md`](./st4ck/docs/prd/KNOWN_GAPS.md) — what's resolved, what's deferred, what needs stakeholder input.
- [`st4ck/docs/prd/SESSION_SUMMARY.md`](./st4ck/docs/prd/SESSION_SUMMARY.md) — most recent authoring session.

If something in this file ever appears to contradict the PRD, the PRD wins.
