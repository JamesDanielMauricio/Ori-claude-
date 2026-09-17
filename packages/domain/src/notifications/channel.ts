// The swappable half of the WhatsApp adapter: "how do we physically hand
// a composed message to a channel" is deliberately the only thing this
// interface covers. Recipient resolution and message composition
// (resolve_outbox_dispatch, packages/db/migrations/0024) already happened
// before a NotificationChannel is ever called — this file has no
// business logic to keep in sync with anything, which is what makes it
// safe to load from both Node (this package, tested via vitest) and Deno
// (supabase/functions/whatsapp-dispatch) without a bundler: zero
// value-level imports, only this one small dependency-free contract.
export interface OutboundMessage {
  to: string;
  // Whether `to` is a WhatsApp group id rather than a phone number. Bare,
  // the two are indistinguishable, and providers address them differently
  // (Green API: "@g.us" vs "@c.us") — so a channel is told, never left to
  // guess from the string.
  isGroup: boolean;
  body: string;
}

export interface SendResult {
  success: boolean;
  error?: string;
}

export interface NotificationChannel {
  send(message: OutboundMessage): Promise<SendResult>;
}
