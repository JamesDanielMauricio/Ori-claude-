---
title: "Shared — Cross-Module Foundations"
node_type: module
source: st4ck PRD (Ori and the Bananas), environment=staging
---

A PRD describes intent by audience, but some artifacts genuinely live across audiences: the header menu a grower sees is the same component a customer sees, the order-status state machine governs both customer order entry and distributor fulfillment, and the WhatsApp integration carries messages triggered from multiple lifecycle steps. Those go here, in one canonical place, with cross-links from each module that touches them.

This module is **not** a place to dump cross-cutting flows that "kind of touch" multiple roles. Those go in each role's module with its own perspective and a cross-link. The shared module is for things that are _physically the same artifact_ on multiple pages.

## Children

- **Components** — UI reusables that mount on multiple pages.
  - [Header Menu](components/header_menu/_index.md) — top bar on Grower Home and Customer Home; hamburger dropdown opens role-filtered navigation.
  - [Sidebar — Customer/Grower](components/sidebar/_index.md) — floating side panel on Grower Home and Customer Home; same component, role-conditional labels.
  - [Page Data-Popup Pattern](components/page_shell/_index.md) — the URL-parameter-driven data-loading shape used by every authenticated page.
- **State machines** — option sets that drive multi-state lifecycles. Each one is a contract for tests and a guide for UI rendering.
  - [Order Status](state_machines/order_status.md) — 5 states.
  - [Shop Status](state_machines/shop_status.md) — 2 states.
  - [Arrangement Status](state_machines/arrangement_status.md) — 2 states.
  - [Pick Status](state_machines/pick_status.md) — 3 states (canonical view; lifecycle transitions live in the Grower module).
  - [Company Status](state_machines/company_status.md) — 2 states.
  - [Day Status](state_machines/day_status.md) — the umbrella flag the app uses to track the trading day.
- **Integrations** — outbound calls to services outside the app.
  - [WhatsApp Messaging](integrations/whatsapp.md) — outbound notifications via a third-party API; fallback to email on failure.
- **Entities** — data types referenced from more than one module.
  - [Company](entities/company.md) — the multi-tenant unit. Every user belongs to exactly one company.
  - [User](entities/user.md) — the authenticated actor; carries role + company association.
  - [Product Family / Product Variety](entities/product_catalog.md) — the catalog of what is sold.
  - [Daily Shop Product](entities/daily_shop_product.md) — per-product entry on a day's shop, with pricing.
  - [App Settings](entities/app_settings.md) — singleton config that drives the day's trading state.
  - [Session](entities/session.md) — append-only audit records of major lifecycle events.
  - [Alerts](entities/alerts.md) — the in-app notification subsystem (Alerts + Alert Types + main alert).

## What does _not_ belong here

- Role-specific UI surfaces (Grower's day list, Customer's order form, Distributor's arrangement dashboard) — these live in their respective modules.
- Lifecycle flows that "cross modules conceptually" (e.g., the daily trading day cycle) — those are described in the Distributor module with cross-links into Grower and Customer.
- Memory or speculation about how things "should" work — only what the code currently does.
