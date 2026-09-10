// The WhatsApp adapter's actual dispatch job — drains notification_outbox
// (packages/db/migrations/0020, extended in 0023/0024) after
// close_arrangement's transaction has already committed (R4's
// external-system carve-out: no outbound HTTP call ever happens inside
// that transaction, only inside this separately-scheduled function).
//
// Deliberately thin: the real business logic — which template to use,
// who the actual send targets are (a company's WhatsApp group, or each
// individual user's phone, 972-prefixed), and the %TOKEN% placeholder
// substitution — lives entirely in Postgres
// (resolve_outbox_dispatch/substitute_template_placeholders, 0024),
// tested there directly via packages/domain/src/notifications/
// notifications.test.ts against the real database. This file's own loop
// mirrors packages/domain/src/notifications/drain.ts's orchestration
// (fetch pending rows -> resolve -> send -> record outcome) but is not a
// direct import of it: Deno can't resolve that package's other
// workspace-aliased imports (@ori/db, drizzle-orm) without a bundler this
// project doesn't have set up, so the loop is reimplemented here against
// the one thing that IS safely importable across both runtimes — nothing,
// in this case, since even drain.ts's own SupabaseClient import is
// type-only. What matters is kept in one place (Postgres); what's
// duplicated (a ~15-line fetch-and-loop) has no logic complex enough to
// drift.
//
// WhatsApp provider: Green API (https://green-api.com). sendMessage is a
// plain POST to https://api.green-api.com/waInstance{idInstance}/
// sendMessage/{apiToken} with a {chatId, message} JSON body — no
// Authorization header, the instance id + token are baked into the URL
// path itself.
//
// Dev/live credential separation: WHATSAPP_ENV selects which of two
// credential pairs (WHATSAPP_DEV_*/WHATSAPP_LIVE_*) this invocation uses.
// Defaults to "dev" for anything other than exactly "live" — a
// missing/misconfigured env var must never silently fall through to live
// credentials and send a real message. The selected env is logged
// server-side (visible only in `supabase functions logs`, never in the
// HTTP response body) so a test invocation's credential choice can be
// confirmed without exposing the credential values themselves in the log.
//
// Per-invocation override: an optional JSON body `{"forceEnv": "live"}`
// lets a single, manual, explicitly-authenticated invocation use the live
// credential pair for verification WITHOUT flipping the WHATSAPP_ENV
// secret globally (go-live cutover, Section 1) — the same "explicit
// opt-in, safe default otherwise" shape as WHATSAPP_ENV itself: any body
// that isn't exactly `{"forceEnv": "live"}` (missing, malformed, a typo,
// no body at all — the shape a scheduled/cron trigger always sends)
// leaves selectWhatsAppEnv()'s own WHATSAPP_ENV-based decision completely
// unchanged. This body-based override is never meant to be sent by an
// automated trigger — only a human running a one-off verification call.
//
// Scheduling: not configured here (a scheduled-job/cron trigger is an
// infrastructure decision outside this repo's own migrations). Invoke
// manually via `supabase functions invoke whatsapp-dispatch` for a manual
// drain, or wire a Supabase Cron / pg_cron trigger calling this function's
// URL on an interval once a schedule is decided.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_ATTEMPTS = 5;

interface PendingOutboxRow {
  id: string;
  template_key: string;
  // Targets already delivered to on an earlier pass (migration 0038); skipped
  // rather than re-sent.
  sent_targets: string[] | null;
}

interface DispatchTarget {
  target: string;
  message: string;
}

interface GreenApiCredentials {
  idInstance: string;
  apiToken: string;
}

// Exactly "live" opts in to live credentials; every other value (unset,
// typo'd, empty string) falls back to "dev" — the safe direction to fail
// in, per the task.
function selectWhatsAppEnv(): "dev" | "live" {
  return Deno.env.get("WHATSAPP_ENV") === "live" ? "live" : "dev";
}

function getGreenApiCredentials(env: "dev" | "live"): GreenApiCredentials {
  const prefix = env === "live" ? "WHATSAPP_LIVE" : "WHATSAPP_DEV";
  return {
    idInstance: Deno.env.get(`${prefix}_ID_INSTANCE`) ?? "",
    apiToken: Deno.env.get(`${prefix}_API_TOKEN`) ?? "",
  };
}

// Green API chat ids are `{phone}@c.us` for an individual and
// `{id}@g.us` for a group. resolve_outbox_dispatch's `target` is either a
// raw phone number (the 972-prefixed individual-dispatch batch) or
// whatever string a company's whatsapp_group_id was set to — if that
// already looks like a Green API id (contains "@"), it's passed through
// unchanged rather than double-suffixed.
function toChatId(target: string): string {
  return target.includes("@") ? target : `${target}@c.us`;
}

async function sendWhatsAppMessage(
  to: string,
  body: string,
  credentials: GreenApiCredentials,
): Promise<{ success: boolean; error?: string }> {
  if (!credentials.idInstance || !credentials.apiToken) {
    return { success: false, error: "WhatsApp credentials are not configured for the active environment" };
  }
  const url = `https://api.green-api.com/waInstance${credentials.idInstance}/sendMessage/${credentials.apiToken}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: toChatId(to), message: body }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { success: false, error: `Green API responded ${response.status}${detail ? `: ${detail}` : ""}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

Deno.serve(async (req) => {
  let forcedEnv: "live" | undefined;
  try {
    const body = await req.json();
    if (body && typeof body === "object" && (body as { forceEnv?: unknown }).forceEnv === "live") {
      forcedEnv = "live";
    }
  } catch {
    // No body, empty body, or non-JSON body — exactly what a scheduled/
    // cron trigger sends. Falls through to the WHATSAPP_ENV-based default
    // below, same as before this override existed.
  }

  const whatsappEnv = forcedEnv ?? selectWhatsAppEnv();
  const credentials = getGreenApiCredentials(whatsappEnv);
  // Server-side only — this line is what lets a test invocation's log
  // confirm which credential pair actually fired, without ever printing
  // the idInstance/apiToken values themselves. Explicitly notes whether
  // this was the WHATSAPP_ENV default or a one-off forceEnv override, so
  // a go-live verification log entry is unambiguous.
  console.log(
    `[whatsapp-dispatch] active credential set: WHATSAPP_${whatsappEnv.toUpperCase()}_* (${forcedEnv ? "forced via request body" : "WHATSAPP_ENV default"})`,
  );

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: settings, error: settingsError } = await client
    .from("notification_settings")
    .select("whatsapp_enabled, close_arrangement_whatsapp_enabled")
    .single();
  if (settingsError) {
    return Response.json({ error: settingsError.message }, { status: 500 });
  }

  const { data: pendingRows, error: pendingError } = await client
    .from("notification_outbox")
    .select("id, template_key, sent_targets")
    .is("sent_at", null)
    .lt("attempt_count", MAX_ATTEMPTS);
  if (pendingError) {
    return Response.json({ error: pendingError.message }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of (pendingRows ?? []) as PendingOutboxRow[]) {
    const requiresCloseArrangementToggle = row.template_key.startsWith("close_arrangement");
    const eligible =
      settings.whatsapp_enabled && (!requiresCloseArrangementToggle || settings.close_arrangement_whatsapp_enabled);
    if (!eligible) {
      skipped += 1;
      continue;
    }

    const { data: targets, error: resolveError } = await client.rpc("resolve_outbox_dispatch", {
      p_outbox_id: row.id,
    });
    if (resolveError) {
      await recordFailure(client, row.id, resolveError.message);
      failed += 1;
      continue;
    }

    // Per-target delivery tracking — mirrors packages/domain/src/notifications/
    // drain.ts exactly (this file is the Deno copy of that loop; see its header
    // comment for why the duplication exists). A row fans out to one message
    // per recipient when the company has no WhatsApp group id, and judging the
    // row as a whole meant one unreachable number re-sent the message to every
    // other recipient on each retry. See migration 0038.
    const alreadySent = new Set<string>(row.sent_targets ?? []);
    const resolvedTargets = (targets ?? []) as DispatchTarget[];
    const errors: string[] = [];

    for (const { target, message } of resolvedTargets) {
      if (alreadySent.has(target)) continue;

      const result = await sendWhatsAppMessage(target, message, credentials);
      if (!result.success) {
        errors.push(result.error ?? `send to ${target} failed`);
        continue;
      }

      alreadySent.add(target);

      const { error: recordError } = await client.rpc("record_outbox_target_sent", {
        p_outbox_id: row.id,
        p_target: target,
        p_complete: false,
      });
      if (recordError) errors.push(recordError.message);
    }

    if (errors.length === 0) {
      // Stamped once after the loop from "nothing failed", not from "this was
      // the last target": resolve_outbox_dispatch's per-user branch has no
      // ORDER BY, so a flag hung off the final iteration would be missed
      // whenever the last target was an already-delivered one that got
      // skipped. The empty target carries only the flag (the function ignores
      // a blank target for the list), which also closes out a row that
      // resolved to no targets at all.
      const { error: completeError } = await client.rpc("record_outbox_target_sent", {
        p_outbox_id: row.id,
        p_target: "",
        p_complete: true,
      });
      if (completeError) {
        await recordFailure(client, row.id, completeError.message);
        failed += 1;
        continue;
      }
      sent += 1;
    } else {
      await recordFailure(client, row.id, errors.join("; "));
      failed += 1;
    }
  }

  return Response.json({ processed: (pendingRows ?? []).length, sent, failed, skipped });
});

async function recordFailure(
  // deno-lint-ignore no-explicit-any
  client: any,
  outboxId: string,
  error: string,
): Promise<void> {
  // One statement that increments from the column's own value, instead of a
  // select-then-update that loses an increment whenever two drain passes
  // overlap. See migration 0038.
  await client.rpc("record_outbox_attempt", { p_outbox_id: outboxId, p_error: error });
}
