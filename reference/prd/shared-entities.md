---
title: "Shared Entities"
node_type: section
source: st4ck PRD (Ori and the Bananas), environment=staging
---

- [Company](company.md) — the multi-tenant unit.
- [User](user.md) — the authenticated actor.
- [Product Catalog (Family + Variety)](product_catalog.md) — the two-level catalog of produce.
- [Daily Shop Product](daily_shop_product.md) — per-product entry on a day's shop, with pricing.
- [App Settings](app_settings.md) — the singleton config that drives the trading day.
- [Session](session.md) — append-only audit records of lifecycle steps.
- [Alerts](alerts.md) — the in-app notification subsystem (Alerts + Alert Types + main alert).
