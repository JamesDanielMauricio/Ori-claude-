import type { NotificationChannel, OutboundMessage, SendResult } from "./channel";

// The real adapter — a third-party WhatsApp API call wrapped behind
// NotificationChannel, per the task's "swappable, not hard-wired into
// calling code" requirement. Built on plain `fetch`, deliberately: no
// Node-specific or npm-package-specific API, so this same file runs
// unmodified under Deno (supabase/functions/whatsapp-dispatch imports it
// directly by relative path) as well as Node (this package's own tests,
// and any future Node-hosted caller). Swapping providers means writing a
// new function with this same shape, not touching drain.ts or the Edge
// Function's wiring.
export interface WhatsAppChannelConfig {
  apiUrl: string;
  apiKey: string;
}

export function createWhatsAppChannel(config: WhatsAppChannelConfig): NotificationChannel {
  return {
    async send({ to, body }: OutboundMessage): Promise<SendResult> {
      try {
        const response = await fetch(config.apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ to, body }),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          return { success: false, error: `WhatsApp API responded ${response.status}${detail ? `: ${detail}` : ""}` };
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
