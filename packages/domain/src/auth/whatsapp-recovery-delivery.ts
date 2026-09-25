import { db } from "@ori/db";
import { notificationSettings } from "@ori/db/schema";

import {
  createGreenApiChannel,
  readGreenApiCredentials,
  selectWhatsAppEnv,
  toWhatsAppNumber,
} from "../notifications/whatsapp-channel";

import type { RecoveryLinkDelivery, RecoveryLinkReceipt } from "./admin-reset-password";
import { RecoveryLinkSendFailedError, RecoveryLinkUndeliverableError } from "./errors";

// Delivers an admin-mediated reset's recovery link by WhatsApp, to the phone
// number on the target user's own profile — never to their company's group,
// since the link signs whoever opens it in as that user.
//
// `prepare` runs every check that can fail before anything has been changed,
// so a reset that can't reach the user is refused with the account untouched;
// only the send it returns happens after the reset is applied.

export interface WhatsAppSettings {
  whatsappEnabled: boolean;
  whatsappDevOverridePhone: string | null;
}

async function loadWhatsAppSettings(): Promise<WhatsAppSettings> {
  const [row] = await db
    .select({
      whatsappEnabled: notificationSettings.whatsappEnabled,
      whatsappDevOverridePhone: notificationSettings.whatsappDevOverridePhone,
    })
    .from(notificationSettings)
    .limit(1);
  // notification_settings is a single-row table seeded by its migration; no
  // row at all means nothing has enabled WhatsApp.
  return row ?? { whatsappEnabled: false, whatsappDevOverridePhone: null };
}

export function composeRecoveryMessage({
  displayName,
  actionLink,
  devRedirectedFrom,
}: {
  displayName: string;
  actionLink: string;
  // Set in the dev environment, where the message goes to the test phone
  // instead: says whose reset it is, so the tester isn't left guessing.
  devRedirectedFrom?: string;
}): string {
  // First name only, the same split resolve_outbox_dispatch uses for its
  // %FIRST_NAME% token.
  const firstName = displayName.trim().split(/\s+/)[0] ?? "";
  const lines = [
    ...(devRedirectedFrom ? [`[מצב פיתוח — ההודעה נועדה ל: ${devRedirectedFrom}]`] : []),
    firstName ? `שלום ${firstName},` : "שלום,",
    "הסיסמה שלך במערכת אורי והבננות אופסה על ידי המשרד.",
    "לקביעת סיסמה חדשה יש להיכנס לקישור הבא. הקישור חד-פעמי ותקף לזמן מוגבל:",
    actionLink,
    "אם לא ציפית להודעה הזו, יש לפנות למשרד.",
  ];
  return lines.join("\n");
}

export function createWhatsAppRecoveryDelivery({
  env = process.env,
  fetchImpl = fetch,
  loadSettings = loadWhatsAppSettings,
}: {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  loadSettings?: () => Promise<WhatsAppSettings>;
} = {}): RecoveryLinkDelivery {
  return {
    async prepare({ displayName, phoneNumber }) {
      // Checked in both environments, so a user missing a number is found
      // while testing rather than on the first live reset.
      if (!phoneNumber?.trim()) throw new RecoveryLinkUndeliverableError("no_phone");
      const targetNumber = toWhatsAppNumber(phoneNumber);
      if (!targetNumber) throw new RecoveryLinkUndeliverableError("invalid_phone");

      const settings = await loadSettings();
      if (!settings.whatsappEnabled) throw new RecoveryLinkUndeliverableError("whatsapp_disabled");

      const whatsappEnv = selectWhatsAppEnv(env);
      const credentials = readGreenApiCredentials(env, whatsappEnv);
      if (!credentials) throw new RecoveryLinkUndeliverableError("whatsapp_not_configured");

      // Dev never messages a real person: every send goes to the configured
      // test phone instead, exactly as whatsapp-dispatch does in dev — and,
      // like it, refuses rather than falling back to the real number.
      let destination = targetNumber;
      if (whatsappEnv === "dev") {
        const devNumber = toWhatsAppNumber(settings.whatsappDevOverridePhone);
        if (!devNumber) throw new RecoveryLinkUndeliverableError("dev_phone_missing");
        destination = devNumber;
      }

      const channel = createGreenApiChannel(credentials, fetchImpl);
      return async (actionLink: string): Promise<RecoveryLinkReceipt> => {
        const body = composeRecoveryMessage({
          displayName,
          actionLink,
          ...(whatsappEnv === "dev" ? { devRedirectedFrom: displayName } : {}),
        });
        const result = await channel.send({ to: destination, isGroup: false, body });
        if (!result.success) {
          throw new RecoveryLinkSendFailedError(result.error ?? "unknown error");
        }
        return { lastDigits: destination.slice(-4), devRedirected: whatsappEnv === "dev" };
      };
    },
  };
}
