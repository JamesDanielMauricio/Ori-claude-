import type { SupabaseClient } from "@supabase/supabase-js";

// Fire-and-forget trigger for the WhatsApp outbox drain (supabase/functions/
// whatsapp-dispatch), called right after an action that queues a
// notification_outbox row (currently: the reminder bells in
// distributor-customer.tsx/distributor-grower.tsx) so the message goes out
// the moment someone clicks, instead of waiting for the next scheduled
// drain. The outbox row itself — written server-side by the RPC that just
// succeeded — stays the durable source of truth: if this call fails, times
// out, or the tab closes before it fires, the row is simply still sitting
// there unsent, exactly as it would be with no nudge at all, ready for the
// next drain (scheduled or manual) to pick it up.
//
// Deliberately never awaited by its caller and never throws: a slow or
// unreachable WhatsApp provider must not make the button that triggered it
// feel slow or show an error, since the thing the click actually promised —
// queueing the reminder — already succeeded before this runs. Same
// external-system carve-out this app already applies to close_arrangement's
// own transaction (R4), extended to the click that queues most other sends.
//
// SECURITY: invoked with an EMPTY body on purpose. whatsapp-dispatch reads
// exactly one thing from its request body — `{"forceEnv": "live"}`, a
// manual go-live verification override meant for a one-off authenticated-by-
// hand call, never an automated trigger. This runs inside an ordinary
// signed-in backoffice session, so it must always look like a routine
// scheduled trigger to the function — an empty body falls through to
// whatever WHATSAPP_ENV is set to server-side, never forcing live sends.
export function nudgeWhatsAppDispatch(client: SupabaseClient): void {
  void client.functions.invoke("whatsapp-dispatch", { body: {} }).catch((error: unknown) => {
    console.warn(
      "[whatsapp-dispatch] nudge failed — the message stays queued for the next drain",
      error,
    );
  });
}
