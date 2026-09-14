import { db } from "@ori/db";
import { companies, notificationSettings } from "@ori/db/schema";
import type { Database } from "@ori/db/supabase-types";
import {
  createTestBackofficeAdmin,
  createTestCompany,
  createTestProfile,
  deleteTestBackofficeAdmin,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "@ori/domain/auth/testing";
import { createTestTradingDay, deleteTestTradingDay } from "@ori/domain/lifecycle-engine/testing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { drainNotificationOutbox } from "./drain";
import { createAlertInputSchema, NOTIFICATION_ERROR_CODES, toCreateAlertRpcArgs } from "./schemas";
import {
  createTestAlert,
  createTestAlertType,
  createTestNotificationTemplate,
  createTestOutboxRow,
  deleteTestAlert,
  deleteTestAlertType,
  deleteTestNotificationTemplate,
  FakeNotificationChannel,
} from "./test-helpers";

// notification_settings is a real global singleton (see its schema
// file's own comment) — every test here that flips a toggle restores both
// to false (the migration-seeded default) in its own cleanup, the same
// discipline lifecycle.test.ts already applies to the single-open-
// trading-day constraint. Sequential execution across the whole domain
// package (vitest.config.ts's fileParallelism: false) is what keeps this
// file's toggle flips from racing any other file's.
describe("notifications module", () => {
  const cleanupFns: Array<() => Promise<void>> = [];
  const adminCleanupFns: Array<() => Promise<void>> = [];
  let admin: { client: SupabaseClient<Database>; userId: string };

  beforeAll(async () => {
    const company = await createTestCompany();
    adminCleanupFns.push(() => deleteTestCompany(company.id));
    const profile = await createTestProfile({ companyId: company.id, role: "backoffice" });
    adminCleanupFns.push(() => deleteTestUser(profile.userId));
    admin = { client: await signInTestUser(profile.email, profile.password), userId: profile.userId };
  });

  afterAll(async () => {
    await runCleanup(adminCleanupFns);
  });

  afterEach(async () => {
    await runCleanup(cleanupFns);
    await db
      .update(notificationSettings)
      .set({
        whatsappEnabled: false,
        notifyGrowersOnBusinessDayOpen: false,
        shopOpenWhatsappEnabled: false,
        closeArrangementCustomerWhatsappEnabled: false,
        closeArrangementGrowerWhatsappEnabled: false,
      })
      .where(eq(notificationSettings.id, true));
  });

  it("alerts RLS: a user can read and mark their own alerts as read, not another user's", async () => {
    const alertType = await createTestAlertType();
    cleanupFns.push(() => deleteTestAlertType(alertType.id));

    const companyA = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(companyA.id));
    const userA = await createTestProfile({ companyId: companyA.id, role: "customer" });
    cleanupFns.push(() => deleteTestUser(userA.userId));
    const clientA = await signInTestUser(userA.email, userA.password);

    const companyB = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(companyB.id));
    const userB = await createTestProfile({ companyId: companyB.id, role: "customer" });
    cleanupFns.push(() => deleteTestUser(userB.userId));
    const clientB = await signInTestUser(userB.email, userB.password);

    const alertForA = await createTestAlert({ intendedForUserId: userA.userId, alertTypeId: alertType.id });
    cleanupFns.push(() => deleteTestAlert(alertForA.id));

    // A can read their own alert.
    const ownRead = await clientA.from("alerts").select("id, read").eq("id", alertForA.id).maybeSingle();
    expect(ownRead.error).toBeNull();
    expect(ownRead.data).toMatchObject({ id: alertForA.id, read: false });

    // B cannot read A's alert — RLS filters it out (empty result, not an error).
    const crossRead = await clientB.from("alerts").select("id").eq("id", alertForA.id).maybeSingle();
    expect(crossRead.error).toBeNull();
    expect(crossRead.data).toBeNull();

    // B cannot mark A's alert as read either — the update matches zero rows.
    const crossUpdate = await clientB.from("alerts").update({ read: true }).eq("id", alertForA.id).select();
    expect(crossUpdate.error).toBeNull();
    expect(crossUpdate.data).toEqual([]);

    // A can mark their own alert as read.
    const ownUpdate = await clientA.from("alerts").update({ read: true }).eq("id", alertForA.id).select();
    expect(ownUpdate.error).toBeNull();
    expect(ownUpdate.data).toMatchObject([{ id: alertForA.id, read: true }]);
  }, 30000);

  it("create_alert resolves send_as_whatsapp/send_as_notification from the alert type's defaults, and rejects a non-backoffice caller", async () => {
    const alertType = await createTestAlertType({ sendAsWhatsappDefault: true, sendAsNotificationDefault: false });
    cleanupFns.push(() => deleteTestAlertType(alertType.id));

    const customerCompany = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));
    const customerUser = await createTestProfile({ companyId: customerCompany.id, role: "customer" });
    cleanupFns.push(() => deleteTestUser(customerUser.userId));
    const customerClient = await signInTestUser(customerUser.email, customerUser.password);

    // A non-backoffice caller is rejected outright.
    const forbidden = await customerClient.rpc(
      "create_alert",
      toCreateAlertRpcArgs(
        createAlertInputSchema.parse({ intendedForUserId: customerUser.userId, alertTypeId: alertType.id }),
      ),
    );
    expect(forbidden.error).not.toBeNull();
    expect(forbidden.error?.code).toBe(NOTIFICATION_ERROR_CODES.FORBIDDEN);

    const created = await admin.client.rpc(
      "create_alert",
      toCreateAlertRpcArgs(
        createAlertInputSchema.parse({ intendedForUserId: customerUser.userId, alertTypeId: alertType.id }),
      ),
    );
    expect(created.error).toBeNull();
    expect(created.data).toMatchObject({
      intended_for_user_id: customerUser.userId,
      send_as_whatsapp: true,
      send_as_notification: false,
    });
    cleanupFns.push(() => deleteTestAlert(created.data!.id));

    // An explicit override wins over the alert type's own default.
    const overridden = await admin.client.rpc(
      "create_alert",
      toCreateAlertRpcArgs(
        createAlertInputSchema.parse({
          intendedForUserId: customerUser.userId,
          alertTypeId: alertType.id,
          sendAsNotification: true,
        }),
      ),
    );
    expect(overridden.error).toBeNull();
    expect(overridden.data).toMatchObject({ send_as_whatsapp: true, send_as_notification: true });
    cleanupFns.push(() => deleteTestAlert(overridden.data!.id));
  }, 30000);

  it("resolve_outbox_dispatch routes to the company's WhatsApp group when set, substituting the company name for %FIRST_NAME%", async () => {
    const template = await createTestNotificationTemplate({
      content: "%FIRST_NAME% - %ORDER_DETAILS% - %CURRENT_OPEN_BUSINESS_DAY%%NL%end",
      link: "https://example.test/day",
    });
    cleanupFns.push(() => deleteTestNotificationTemplate(template.id));

    const growerCompany = await createTestCompany(`Test Grower ${crypto.randomUUID()}`, "grower");
    cleanupFns.push(() => deleteTestCompany(growerCompany.id));
    await db.update(companies).set({ whatsappGroupId: "grp-123" }).where(eq(companies.id, growerCompany.id));

    const admin2 = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin2));
    const day = await createTestTradingDay({ initiatedByUserId: admin2.userId });
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const outboxRow = await createTestOutboxRow({
      tradingDayId: day.id,
      recipientType: "grower",
      recipientCompanyId: growerCompany.id,
      templateKey: template.templateKey,
      payload: {
        tradeDate: "2026-07-12",
        lines: [{ familyName: "בננה", varietyName: "צהובה", quantityPallets: "3.00", customerCompanyName: "לקוח א" }],
      },
    });

    const { data, error } = await admin.client.rpc("resolve_outbox_dispatch", { p_outbox_id: outboxRow.id });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]!.target).toBe("grp-123");
    expect(data![0]!.message).toContain(growerCompany.name);
    expect(data![0]!.message).toContain("בננה — צהובה");
    expect(data![0]!.message).toContain("2026-07-12");
    expect(data![0]!.message).toContain("https://example.test/day");
  }, 30000);

  it("resolve_outbox_dispatch routes to each individual user's phone (972-prefixed, leading 0 stripped) when no group id is set, skipping users with no phone", async () => {
    const template = await createTestNotificationTemplate({
      content: "%FIRST_NAME% hi%NL%%ORDER_DETAILS%",
    });
    cleanupFns.push(() => deleteTestNotificationTemplate(template.id));

    const customerCompany = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));

    const withPhone = await createTestProfile({
      companyId: customerCompany.id,
      role: "customer",
      displayName: "Dana Cohen",
      phoneNumber: "0501234567",
    });
    cleanupFns.push(() => deleteTestUser(withPhone.userId));

    const withoutPhone = await createTestProfile({
      companyId: customerCompany.id,
      role: "customer",
      displayName: "NoPhone User",
    });
    cleanupFns.push(() => deleteTestUser(withoutPhone.userId));

    const admin2 = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin2));
    const day = await createTestTradingDay({ initiatedByUserId: admin2.userId });
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const outboxRow = await createTestOutboxRow({
      tradingDayId: day.id,
      recipientType: "customer",
      recipientCompanyId: customerCompany.id,
      templateKey: template.templateKey,
      payload: { tradeDate: "2026-07-12", lines: [] },
    });

    const { data, error } = await admin.client.rpc("resolve_outbox_dispatch", { p_outbox_id: outboxRow.id });
    expect(error).toBeNull();
    // Only the user with a phone on file is a real send target.
    expect(data).toHaveLength(1);
    expect(data![0]!.target).toBe("972501234567");
    expect(data![0]!.message).toContain("Dana hi");
  }, 30000);

  it("drainNotificationOutbox skips rows when the global toggle is off, and skips only close_arrangement-templated rows when the flow-specific toggle is off", async () => {
    const template = await createTestNotificationTemplate({ templateKey: `test_template_${crypto.randomUUID()}` });
    cleanupFns.push(() => deleteTestNotificationTemplate(template.id));
    // Prefixed like the real seeded 'close_arrangement_customer' key
    // (isEligible only checks the prefix) — the random suffix avoids
    // colliding with that real, migration-seeded row's unique template_key.
    const closeArrangementTemplate = await createTestNotificationTemplate({
      templateKey: `close_arrangement_customer_test_${crypto.randomUUID()}`,
    });
    cleanupFns.push(() => deleteTestNotificationTemplate(closeArrangementTemplate.id));

    const company = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(company.id));
    await db.update(companies).set({ whatsappGroupId: "grp-toggle-test" }).where(eq(companies.id, company.id));

    const admin2 = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin2));
    const day = await createTestTradingDay({ initiatedByUserId: admin2.userId });
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const genericRow = await createTestOutboxRow({
      tradingDayId: day.id,
      recipientType: "customer",
      recipientCompanyId: company.id,
      templateKey: template.templateKey,
      payload: { lines: [] },
    });
    const closeArrangementRow = await createTestOutboxRow({
      tradingDayId: day.id,
      recipientType: "customer",
      recipientCompanyId: company.id,
      templateKey: closeArrangementTemplate.templateKey,
      payload: { lines: [] },
    });

    // Both toggles off: nothing is sent at all.
    const channel1 = new FakeNotificationChannel();
    const result1 = await drainNotificationOutbox({ client: admin.client, channel: channel1 });
    expect(result1.skippedTogglesOff).toBe(2);
    expect(channel1.sent).toHaveLength(0);

    // Global on, close-arrangement-specific toggle still off: the generic
    // template sends, the close_arrangement one is still held back.
    await admin.client.from("notification_settings").update({ whatsapp_enabled: true }).eq("id", true);
    const channel2 = new FakeNotificationChannel();
    const result2 = await drainNotificationOutbox({ client: admin.client, channel: channel2 });
    expect(result2.sent).toBe(1);
    expect(result2.skippedTogglesOff).toBe(1);
    expect(channel2.sent).toHaveLength(1);

    const { data: genericAfter } = await admin.client.from("notification_outbox").select("sent_at").eq("id", genericRow.id).single();
    expect(genericAfter?.sent_at).not.toBeNull();
    const { data: closeArrangementAfter } = await admin.client
      .from("notification_outbox")
      .select("sent_at")
      .eq("id", closeArrangementRow.id)
      .single();
    expect(closeArrangementAfter?.sent_at).toBeNull();

    // Both toggles on: the previously-held-back row now sends too.
    await admin.client
      .from("notification_settings")
      .update({ close_arrangement_customer_whatsapp_enabled: true })
      .eq("id", true);
    const channel3 = new FakeNotificationChannel();
    const result3 = await drainNotificationOutbox({ client: admin.client, channel: channel3 });
    expect(result3.sent).toBe(1);
    expect(result3.skippedTogglesOff).toBe(0);
  }, 30000);

  it("drainNotificationOutbox sends via the injected channel and records a failed send for retry (attempt_count/last_error), without touching sent_at", async () => {
    const template = await createTestNotificationTemplate({ content: "%FIRST_NAME% - %ORDER_DETAILS%" });
    cleanupFns.push(() => deleteTestNotificationTemplate(template.id));

    const company = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(company.id));
    await db.update(companies).set({ whatsappGroupId: "grp-fail-test" }).where(eq(companies.id, company.id));

    const admin2 = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin2));
    const day = await createTestTradingDay({ initiatedByUserId: admin2.userId });
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const outboxRow = await createTestOutboxRow({
      tradingDayId: day.id,
      recipientType: "customer",
      recipientCompanyId: company.id,
      templateKey: template.templateKey,
      payload: { lines: [] },
    });

    await admin.client
      .from("notification_settings")
      .update({ whatsapp_enabled: true, close_arrangement_customer_whatsapp_enabled: true, close_arrangement_grower_whatsapp_enabled: true })
      .eq("id", true);

    // First attempt: the fake channel fails every send to this group.
    const failingChannel = new FakeNotificationChannel(["grp-fail-test"]);
    const failResult = await drainNotificationOutbox({ client: admin.client, channel: failingChannel });
    expect(failResult.failed).toBe(1);
    expect(failResult.sent).toBe(0);

    const { data: afterFail } = await admin.client
      .from("notification_outbox")
      .select("sent_at, attempt_count, last_error")
      .eq("id", outboxRow.id)
      .single();
    expect(afterFail?.sent_at).toBeNull();
    expect(afterFail?.attempt_count).toBe(1);
    expect(afterFail?.last_error).toContain("grp-fail-test");

    // Second attempt: the channel now succeeds — the row was left
    // eligible for retry (sent_at still null), so drain picks it up again.
    const succeedingChannel = new FakeNotificationChannel();
    const retryResult = await drainNotificationOutbox({ client: admin.client, channel: succeedingChannel });
    expect(retryResult.sent).toBe(1);

    const { data: afterRetry } = await admin.client
      .from("notification_outbox")
      .select("sent_at")
      .eq("id", outboxRow.id)
      .single();
    expect(afterRetry?.sent_at).not.toBeNull();
  }, 30000);

  // The multi-recipient fan-out is where "did this row send" stops being a
  // single boolean. A company with no whatsapp_group_id resolves to one
  // message PER profile with a phone number (resolve_outbox_dispatch, 0024),
  // and before migration 0038 a failure on any one of them re-sent the message
  // to all of them on the next pass — five copies for the reachable
  // recipients by the time attempt_count hit MAX_ATTEMPTS.
  it("does not re-send to recipients already delivered to when a sibling target failed", async () => {
    const template = await createTestNotificationTemplate({ content: "%FIRST_NAME% - %ORDER_DETAILS%" });
    cleanupFns.push(() => deleteTestNotificationTemplate(template.id));

    // No whatsapp_group_id, so dispatch falls back to per-user messaging.
    const company = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(company.id));

    // resolve_outbox_dispatch builds the target as '972' + the number with a
    // leading zero stripped, so these arrive as 972500000001 / 972500000002.
    const reachable = await createTestProfile({
      companyId: company.id,
      role: "customer",
      displayName: "Reachable User",
      phoneNumber: "0500000001",
    });
    cleanupFns.push(() => deleteTestUser(reachable.userId));
    const unreachable = await createTestProfile({
      companyId: company.id,
      role: "customer",
      displayName: "Unreachable User",
      phoneNumber: "0500000002",
    });
    cleanupFns.push(() => deleteTestUser(unreachable.userId));

    const admin2 = await createTestBackofficeAdmin();
    cleanupFns.push(() => deleteTestBackofficeAdmin(admin2));
    // phase 'closed' deliberately. Nothing in the dispatch path reads the
    // day's phase — resolve_outbox_dispatch goes outbox -> template -> company
    // -> profiles and never looks at it — so this fixture has no reason to
    // compete for the single-open-trading-day partial unique index (0009),
    // which any real open day in the target database would already hold.
    const day = await createTestTradingDay({ initiatedByUserId: admin2.userId, phase: "closed" });
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const outboxRow = await createTestOutboxRow({
      tradingDayId: day.id,
      recipientType: "customer",
      recipientCompanyId: company.id,
      templateKey: template.templateKey,
      payload: { lines: [] },
    });

    await admin.client
      .from("notification_settings")
      .update({ whatsapp_enabled: true, close_arrangement_customer_whatsapp_enabled: true, close_arrangement_grower_whatsapp_enabled: true })
      .eq("id", true);

    // Pass 1: one number is permanently unreachable, the other takes delivery.
    const firstChannel = new FakeNotificationChannel(["972500000002"]);
    const firstPass = await drainNotificationOutbox({ client: admin.client, channel: firstChannel });
    expect(firstPass.failed).toBe(1);
    expect(firstChannel.sent.map((message) => message.to).sort()).toEqual([
      "972500000001",
      "972500000002",
    ]);

    const { data: afterFirst } = await admin.client
      .from("notification_outbox")
      .select("sent_at, attempt_count, sent_targets")
      .eq("id", outboxRow.id)
      .single();
    // The row stays open for retry, but the success is now durably recorded.
    expect(afterFirst?.sent_at).toBeNull();
    expect(afterFirst?.attempt_count).toBe(1);
    expect(afterFirst?.sent_targets).toEqual(["972500000001"]);

    // Pass 2: the same number still fails. The reachable recipient must NOT be
    // contacted again — this assertion is the regression itself.
    const secondChannel = new FakeNotificationChannel(["972500000002"]);
    await drainNotificationOutbox({ client: admin.client, channel: secondChannel });
    expect(secondChannel.sent.map((message) => message.to)).toEqual(["972500000002"]);

    // Pass 3: the number recovers. The row finishes without a duplicate.
    const thirdChannel = new FakeNotificationChannel();
    const thirdPass = await drainNotificationOutbox({ client: admin.client, channel: thirdChannel });
    expect(thirdPass.sent).toBe(1);
    expect(thirdChannel.sent.map((message) => message.to)).toEqual(["972500000002"]);

    const { data: afterThird } = await admin.client
      .from("notification_outbox")
      .select("sent_at, sent_targets")
      .eq("id", outboxRow.id)
      .single();
    expect(afterThird?.sent_at).not.toBeNull();
    expect((afterThird?.sent_targets ?? []).sort()).toEqual(["972500000001", "972500000002"]);
  }, 30000);
});
