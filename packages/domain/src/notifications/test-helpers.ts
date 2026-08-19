import { randomUUID } from "node:crypto";

import { db } from "@ori/db";
import { alertTypes, alerts, notificationOutbox, notificationTemplates } from "@ori/db/schema";
import { eq } from "drizzle-orm";

import type { NotificationChannel, OutboundMessage, SendResult } from "./channel";

// Test-only fixtures for the notifications module — mirrors
// packages/domain/src/reference-data/test-helpers.ts (not part of the
// package's public exports; see package.json).

export interface CreateTestAlertTypeOptions {
  mainText?: string;
  secondLineOfText?: string | null;
  sendAsWhatsappDefault?: boolean;
  sendAsNotificationDefault?: boolean;
  appScreen?: string;
  urlParameter?: string | null;
}

export async function createTestAlertType(options: CreateTestAlertTypeOptions = {}) {
  const [row] = await db
    .insert(alertTypes)
    .values({
      mainText: options.mainText ?? `Test Alert Type ${randomUUID()}`,
      secondLineOfText: options.secondLineOfText ?? null,
      sendAsWhatsappDefault: options.sendAsWhatsappDefault ?? false,
      sendAsNotificationDefault: options.sendAsNotificationDefault ?? true,
      appScreen: options.appScreen ?? "/customer/history",
      urlParameter: options.urlParameter ?? null,
    })
    .returning();
  if (!row) throw new Error("failed to create test alert type");
  return row;
}

export async function deleteTestAlertType(id: string): Promise<void> {
  await db.delete(alertTypes).where(eq(alertTypes.id, id));
}

export interface CreateTestAlertOptions {
  intendedForUserId: string;
  alertTypeId: string;
  read?: boolean;
  displayRecordId?: string | null;
  numberForDisplay?: number | null;
  fullNameForDisplay?: string | null;
  sendAsWhatsapp?: boolean;
  sendAsNotification?: boolean;
}

// Direct-insert fixture standing in for create_alert — this module's own
// RLS tests need real alerts rows to exist without going through the
// backoffice-only RPC every time.
export async function createTestAlert(options: CreateTestAlertOptions) {
  const [row] = await db
    .insert(alerts)
    .values({
      intendedForUserId: options.intendedForUserId,
      alertTypeId: options.alertTypeId,
      read: options.read ?? false,
      displayRecordId: options.displayRecordId ?? null,
      numberForDisplay: options.numberForDisplay?.toString() ?? null,
      fullNameForDisplay: options.fullNameForDisplay ?? null,
      sendAsWhatsapp: options.sendAsWhatsapp ?? false,
      sendAsNotification: options.sendAsNotification ?? true,
    })
    .returning();
  if (!row) throw new Error("failed to create test alert");
  return row;
}

export async function deleteTestAlert(id: string): Promise<void> {
  await db.delete(alerts).where(eq(alerts.id, id));
}

export interface CreateTestNotificationTemplateOptions {
  templateKey?: string;
  title?: string | null;
  content?: string;
  link?: string | null;
}

export async function createTestNotificationTemplate(options: CreateTestNotificationTemplateOptions = {}) {
  const [row] = await db
    .insert(notificationTemplates)
    .values({
      templateKey: options.templateKey ?? `test_template_${randomUUID()}`,
      title: options.title ?? "Test Title",
      content: options.content ?? "%FIRST_NAME% - %ORDER_DETAILS% - %CURRENT_OPEN_BUSINESS_DAY%%NL%bye",
      link: options.link ?? null,
    })
    .returning();
  if (!row) throw new Error("failed to create test notification template");
  return row;
}

export async function deleteTestNotificationTemplate(id: string): Promise<void> {
  await db.delete(notificationTemplates).where(eq(notificationTemplates.id, id));
}

export interface CreateTestOutboxRowOptions {
  tradingDayId: string;
  recipientType: "grower" | "customer";
  recipientCompanyId: string;
  templateKey: string;
  payload: unknown;
}

export async function createTestOutboxRow(options: CreateTestOutboxRowOptions) {
  const [row] = await db
    .insert(notificationOutbox)
    .values({
      tradingDayId: options.tradingDayId,
      recipientType: options.recipientType,
      recipientCompanyId: options.recipientCompanyId,
      templateKey: options.templateKey,
      payload: options.payload,
    })
    .returning();
  if (!row) throw new Error("failed to create test notification_outbox row");
  return row;
}

// A NotificationChannel test double: records every send() call, and can
// be configured to fail sends to specific targets — used to exercise
// drainNotificationOutbox's retry/observability bookkeeping without a
// real WhatsApp API call.
export class FakeNotificationChannel implements NotificationChannel {
  readonly sent: OutboundMessage[] = [];
  private readonly failingTargets: Set<string>;

  constructor(failingTargets: string[] = []) {
    this.failingTargets = new Set(failingTargets);
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message);
    if (this.failingTargets.has(message.to)) {
      return { success: false, error: `simulated failure for ${message.to}` };
    }
    return { success: true };
  }
}
