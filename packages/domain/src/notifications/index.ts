// The NotificationService: a swappable NotificationChannel behind a
// single WhatsApp adapter (createWhatsAppChannel), a drain orchestrator
// (drainNotificationOutbox) that any Node-hosted caller can use, and the
// input schemas for create_alert — the one general "notify this user
// in-app" entry point any backoffice-triggered flow can call. The actual
// recipient-resolution and template-substitution business logic lives in
// Postgres (packages/db/migrations/0024_notifications-functions.sql),
// tested there directly, not reimplemented here. See
// docs/ARCHITECTURE.md § Module boundaries.
export type { NotificationChannel, OutboundMessage, SendResult } from "./channel";
export { createWhatsAppChannel, type WhatsAppChannelConfig } from "./whatsapp-channel";
export {
  drainNotificationOutbox,
  type DrainDeps,
  type DrainResult,
  type DrainRowResult,
} from "./drain";
export {
  createAlertInputSchema,
  toCreateAlertRpcArgs,
  type CreateAlertInput,
  NOTIFICATION_ERROR_CODES,
} from "./schemas";
