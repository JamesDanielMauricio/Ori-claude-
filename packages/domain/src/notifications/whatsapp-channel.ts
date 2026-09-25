import type { NotificationChannel, OutboundMessage, SendResult } from "./channel";

// The Node-side Green API adapter (https://green-api.com — the settled
// WhatsApp provider), used by apps/api for the one message that must go out
// synchronously: the admin-mediated password reset's recovery link, where the
// admin needs to know on the spot whether it reached the user.
//
// Everything else still goes through notification_outbox and the
// whatsapp-dispatch Edge Function. This file mirrors that function's own
// sendWhatsAppMessage/toChatId/selectWhatsAppEnv exactly — same endpoint,
// same chat-id suffixes, same WHATSAPP_* variable names, same "anything but
// exactly `live` is dev" rule — so the two senders can't disagree about how a
// message is addressed. Change one, change the other.

export interface GreenApiCredentials {
  idInstance: string;
  apiToken: string;
}

export type WhatsAppEnv = "dev" | "live";

// Defaults to "dev" for anything other than exactly "live": a missing or
// mistyped variable must never fall through to the live number and message a
// real customer.
export function selectWhatsAppEnv(env: Record<string, string | undefined>): WhatsAppEnv {
  return env.WHATSAPP_ENV === "live" ? "live" : "dev";
}

// The active environment's credential pair, or null when either half is
// missing — the caller turns that into a clear "not configured" error before
// anything is changed, rather than failing at send time.
export function readGreenApiCredentials(
  env: Record<string, string | undefined>,
  whatsappEnv: WhatsAppEnv,
): GreenApiCredentials | null {
  const prefix = whatsappEnv === "live" ? "WHATSAPP_LIVE" : "WHATSAPP_DEV";
  const idInstance = env[`${prefix}_ID_INSTANCE`]?.trim() ?? "";
  const apiToken = env[`${prefix}_API_TOKEN`]?.trim() ?? "";
  return idInstance && apiToken ? { idInstance, apiToken } : null;
}

// profiles.phone_number is free text typed by people ("050-123 4567",
// "+972 50…"), so it is reduced to digits before the 972 country code is
// applied — the same "972 + number without its leading 0" rule
// resolve_outbox_dispatch uses (migration 0053), but tolerant of the
// separators that rule would pass straight through to Green API. Returns null
// for anything that can't be an Israeli number once normalized: 972 followed
// by 8 or 9 digits.
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const international = digits.startsWith("972") ? digits : `972${digits.replace(/^0/, "")}`;
  return /^972\d{8,9}$/.test(international) ? international : null;
}

// How long a send may take before it counts as failed — the admin is waiting
// on the screen, and apps/api runs as a Vercel function with its own limit.
const SEND_TIMEOUT_MS = 15_000;

export function createGreenApiChannel(
  credentials: GreenApiCredentials,
  fetchImpl: typeof fetch = fetch,
): NotificationChannel {
  return {
    async send({ to, isGroup, body }: OutboundMessage): Promise<SendResult> {
      // Green API takes the instance id and token in the URL path, not in an
      // Authorization header.
      const url = `https://api.green-api.com/waInstance${credentials.idInstance}/sendMessage/${credentials.apiToken}`;
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: `${to}@${isGroup ? "g" : "c"}.us`, message: body }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          return {
            success: false,
            error: `Green API responded ${response.status}${detail ? `: ${detail}` : ""}`,
          };
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
