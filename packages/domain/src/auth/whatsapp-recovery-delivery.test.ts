import { describe, expect, it } from "vitest";

import { RecoveryLinkSendFailedError, RecoveryLinkUndeliverableError } from "./errors";
import { composeRecoveryMessage, createWhatsAppRecoveryDelivery } from "./whatsapp-recovery-delivery";

// Pure: settings and fetch are injected, so nothing here touches the
// database or Green API.
const DEV_ENV = { WHATSAPP_DEV_ID_INSTANCE: "111", WHATSAPP_DEV_API_TOKEN: "dev-tok" };
const LIVE_ENV = {
  WHATSAPP_ENV: "live",
  WHATSAPP_LIVE_ID_INSTANCE: "222",
  WHATSAPP_LIVE_API_TOKEN: "live-tok",
};
const USER = { displayName: "דנה כהן", phoneNumber: "050-123-4567" };
const LINK = "https://example.supabase.co/auth/v1/verify?token=abc&type=recovery";

function recordingFetch(status = 200) {
  const calls: Array<{ url: string; body: { chatId: string; message: string } }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function settings(whatsappEnabled: boolean, whatsappDevOverridePhone: string | null = null) {
  return async () => ({ whatsappEnabled, whatsappDevOverridePhone });
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(RecoveryLinkUndeliverableError);
  return (error as RecoveryLinkUndeliverableError).reason;
}

describe("createWhatsAppRecoveryDelivery.prepare — refuses before anything is sent", () => {
  it("needs a phone number on the profile", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const delivery = createWhatsAppRecoveryDelivery({ env: LIVE_ENV, fetchImpl, loadSettings: settings(true) });
    expect(await refusal(delivery.prepare({ displayName: "x", phoneNumber: null }))).toBe("no_phone");
    expect(await refusal(delivery.prepare({ displayName: "x", phoneNumber: "  " }))).toBe("no_phone");
    expect(await refusal(delivery.prepare({ displayName: "x", phoneNumber: "12" }))).toBe("invalid_phone");
    expect(calls).toHaveLength(0);
  });

  it("respects the WhatsApp master switch", async () => {
    const delivery = createWhatsAppRecoveryDelivery({ env: LIVE_ENV, loadSettings: settings(false) });
    expect(await refusal(delivery.prepare(USER))).toBe("whatsapp_disabled");
  });

  it("needs credentials for the active environment", async () => {
    const liveWithoutCredentials = createWhatsAppRecoveryDelivery({
      env: { WHATSAPP_ENV: "live", ...DEV_ENV },
      loadSettings: settings(true),
    });
    expect(await refusal(liveWithoutCredentials.prepare(USER))).toBe("whatsapp_not_configured");
  });

  it("refuses in dev without a test phone rather than messaging the real user", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const delivery = createWhatsAppRecoveryDelivery({ env: DEV_ENV, fetchImpl, loadSettings: settings(true, null) });
    expect(await refusal(delivery.prepare(USER))).toBe("dev_phone_missing");
    expect(calls).toHaveLength(0);
  });
});

describe("createWhatsAppRecoveryDelivery — sending", () => {
  it("live: sends the link to the user's own number", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const delivery = createWhatsAppRecoveryDelivery({ env: LIVE_ENV, fetchImpl, loadSettings: settings(true) });
    const send = await delivery.prepare(USER);
    await expect(send(LINK)).resolves.toEqual({ lastDigits: "4567", devRedirected: false });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.green-api.com/waInstance222/sendMessage/live-tok");
    expect(calls[0]!.body.chatId).toBe("972501234567@c.us");
    expect(calls[0]!.body.message).toContain(LINK);
    expect(calls[0]!.body.message).toContain("שלום דנה,");
    expect(calls[0]!.body.message).not.toContain("מצב פיתוח");
  });

  it("dev (and any WHATSAPP_ENV other than exactly `live`): goes to the test phone, never the user", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const delivery = createWhatsAppRecoveryDelivery({
      env: { ...DEV_ENV, WHATSAPP_ENV: "LIVE" },
      fetchImpl,
      loadSettings: settings(true, "972529998888"),
    });
    const send = await delivery.prepare(USER);
    await expect(send(LINK)).resolves.toEqual({ lastDigits: "8888", devRedirected: true });

    expect(calls[0]!.url).toBe("https://api.green-api.com/waInstance111/sendMessage/dev-tok");
    expect(calls[0]!.body.chatId).toBe("972529998888@c.us");
    expect(calls[0]!.body.message).toContain("מצב פיתוח");
    expect(calls[0]!.body.message).toContain(USER.displayName);
    expect(calls[0]!.body.message).toContain(LINK);
  });

  it("turns a failed send into RecoveryLinkSendFailedError", async () => {
    const { fetchImpl } = recordingFetch(500);
    const delivery = createWhatsAppRecoveryDelivery({ env: LIVE_ENV, fetchImpl, loadSettings: settings(true) });
    const send = await delivery.prepare(USER);
    await expect(send(LINK)).rejects.toBeInstanceOf(RecoveryLinkSendFailedError);
  });
});

describe("composeRecoveryMessage", () => {
  it("greets by first name and carries the link on its own line", () => {
    const message = composeRecoveryMessage({ displayName: "  דנה   כהן ", actionLink: LINK });
    expect(message.split("\n")).toContain(LINK);
    expect(message.startsWith("שלום דנה,")).toBe(true);
  });

  it("falls back to a plain greeting without a name", () => {
    expect(composeRecoveryMessage({ displayName: "", actionLink: LINK }).startsWith("שלום,")).toBe(true);
  });
});
