---
title: "Alerts (and Alert Templates)"
node_type: entity
source: st4ck PRD (Ori and the Bananas), environment=staging
---

The platform has a small notification subsystem composed of three data types working together:

## Alerts — one per delivered notification

| Field                 | Type             | Notes                                                                    |
| --------------------- | ---------------- | ------------------------------------------------------------------------ |
| Read                  | boolean          | Has the recipient seen / dismissed this alert?                           |
| Intended For User     | reference → User | Who the alert is addressed to.                                           |
| Display Record UNID   | text             | A reference (probably to a record the alert relates to).                 |
| Number For Display    | number           | Numeric value the alert may show (e.g., a count).                        |
| Full Name For Display | text             | A name the alert may show (e.g., a company name).                        |
| Send as WhatsApp      | boolean          | Should this alert also be sent as a WhatsApp message?                    |
| Send as Notification  | boolean          | Should this alert be sent as a (presumably push or in-app) notification? |

## Alert Types — the templates

| Field                                 | Type                  | Notes                                               |
| ------------------------------------- | --------------------- | --------------------------------------------------- |
| Main Text                             | text                  | The primary message body template.                  |
| Second Line Of Text                   | text                  | A secondary line.                                   |
| Creation Date (additional date field) | date                  | When this template was authored.                    |
| Send as WhatsApp                      | boolean               | Default for instances created from this template.   |
| Send as Notification                  | boolean               | Default for instances created from this template.   |
| App Screen                            | option:app_screens    | The screen to navigate to when the alert is tapped. |
| Parameter To Send                     | option:url_parameters | The URL parameter to pass when navigating.          |

This is a typed-template system: each Alert Type defines a kind of notification with default channels and navigation behavior.

## main alert — named templates used by the WhatsApp dispatch

| Field             | Type                     | Notes                                                                                                          |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| id                | text                     | Lookup key — workflows fetch a `main alert` by its id.                                                         |
| link              | text                     | Outbound URL inserted into the message.                                                                        |
| title             | text                     | Message title (for push notifications).                                                                        |
| alert content     | text                     | The message body with placeholders (`%FIRST_NAME%`, `%ORDER_DETAILS%`, `%CURRENT_OPEN_BUSINESS_DAY%`, `%NL%`). |
| notification type | option:notification_type | Which platform/channel this template targets.                                                                  |

The `close_arrangement` workflow's WhatsApp dispatch (Actions 7 & 8) pulls a `main alert` by id and substitutes placeholders with per-recipient values to build the outbound message.

## How the three relate

- **main alert** is the lookup table for outbound message templates by id. Used at dispatch time.
- **Alert Types** is the configurable bank of template definitions in the platform's admin surface.
- **Alerts** is the delivery log — one record per user-facing notification actually delivered.

> [GAP] The exact relationship between Alert Types and main alert (do Alert Types reference main alert records? Are main alerts a subset?) is not visible from the entity definitions alone — needs grep tracing to confirm. Likely they are parallel template stores serving different code paths.

## Privacy

Alerts (the delivery log) has no privacy rule documented in its `_index` — likely it defaults to "everyone", which would be too permissive. main alert is `everyone, logged in`. Alert Types is similar.

**Privacy is a [GAP] worth tracing:** alert messages can contain order details and personal information; broad read access on the Alerts table could leak across tenants. Verify against the explicit privacy rule files in `Data Types/Alerts/Privacy_*.md` before authoring tests.

## Test implications

- A test of the close-arrangement WhatsApp dispatch must verify the right `main alert` is pulled by id and the placeholders are substituted correctly.
- Alerts table reads should be scoped to the recipient — verify the privacy rule before treating Alerts as cross-tenant-readable.
- Mark as Read should flip the `Read` flag and remove the alert from the user's in-app notification list.
