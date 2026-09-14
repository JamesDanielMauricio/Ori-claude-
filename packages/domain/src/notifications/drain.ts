import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotificationChannel } from "./channel";

// The drain-loop orchestration behind the WhatsApp adapter — fetch
// pending notification_outbox rows, resolve each into its real send
// targets (packages/db/migrations/0024's resolve_outbox_dispatch), hand
// each composed message to the injected NotificationChannel, and record
// the outcome. Deliberately portable: only a type-only import of
// SupabaseClient (erased at runtime, so it never needs to resolve under
// Deno) plus the dependency-free NotificationChannel contract — no
// `@ori/db`, no Node-specific API. supabase/functions/whatsapp-dispatch's
// own Deno entrypoint reimplements this same loop inline (Deno can't
// resolve this package's other workspace-aliased imports without a
// bundler this project doesn't have set up) but calls the identical
// Postgres functions, so the actual business logic — recipient
// resolution and placeholder substitution — is tested exactly once, here,
// against the real database, not reimplemented untested in Deno.
export interface DrainDeps {
  client: SupabaseClient;
  channel: NotificationChannel;
  // Injected so tests don't depend on wall-clock retry math; defaults to
  // the real value in production.
  maxAttempts?: number;
}

export interface DrainRowResult {
  outboxId: string;
  status: "sent" | "failed" | "skipped_toggle_off";
  error?: string;
}

export interface DrainResult {
  processed: number;
  sent: number;
  failed: number;
  skippedTogglesOff: number;
  rows: DrainRowResult[];
}

interface PendingOutboxRow {
  id: string;
  template_key: string;
  // Targets already delivered to on an earlier pass (migration 0038). A row
  // only reaches this loop with a non-empty list when a previous attempt sent
  // to some of its recipients and failed on others.
  sent_targets: string[] | null;
}

interface NotificationSettingsRow {
  whatsapp_enabled: boolean;
  notify_growers_on_business_day_open: boolean;
  shop_open_whatsapp_enabled: boolean;
  close_arrangement_customer_whatsapp_enabled: boolean;
  close_arrangement_grower_whatsapp_enabled: boolean;
}

interface DispatchTarget {
  target: string;
  message: string;
}

const DEFAULT_MAX_ATTEMPTS = 5;

// Mirrors supabase/functions/whatsapp-dispatch's own isEligible exactly —
// see that file's header comment for why this loop is duplicated rather
// than imported. whatsapp_enabled is the global gate every template needs
// regardless; the four more specific toggles below (migration 0049) match
// by prefix rather than exact key, same as the original single
// close_arrangement toggle did — this repo's own tests rely on that (a
// randomized-suffix test template key like
// `close_arrangement_customer_test_<uuid>` needs to match the same toggle
// its real `close_arrangement_customer` counterpart would, without
// colliding with that seeded row's unique template_key).
function isEligible(templateKey: string, settings: NotificationSettingsRow): boolean {
  if (!settings.whatsapp_enabled) return false;
  if (templateKey.startsWith("close_arrangement_customer")) return settings.close_arrangement_customer_whatsapp_enabled;
  if (templateKey.startsWith("close_arrangement_grower")) return settings.close_arrangement_grower_whatsapp_enabled;
  if (templateKey === "shop_open") return settings.shop_open_whatsapp_enabled;
  if (templateKey === "business_day_open_grower") return settings.notify_growers_on_business_day_open;
  return true;
}

export async function drainNotificationOutbox(deps: DrainDeps): Promise<DrainResult> {
  const { client, channel } = deps;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const { data: settingsRow, error: settingsError } = await client
    .from("notification_settings")
    .select(
      "whatsapp_enabled, notify_growers_on_business_day_open, shop_open_whatsapp_enabled, close_arrangement_customer_whatsapp_enabled, close_arrangement_grower_whatsapp_enabled",
    )
    .single();
  if (settingsError) throw settingsError;
  const settings = settingsRow as NotificationSettingsRow;

  const { data: pendingRows, error: pendingError } = await client
    .from("notification_outbox")
    .select("id, template_key, sent_targets")
    .is("sent_at", null)
    .lt("attempt_count", maxAttempts);
  if (pendingError) throw pendingError;

  const result: DrainResult = { processed: 0, sent: 0, failed: 0, skippedTogglesOff: 0, rows: [] };

  for (const row of (pendingRows ?? []) as PendingOutboxRow[]) {
    result.processed += 1;

    if (!isEligible(row.template_key, settings)) {
      result.skippedTogglesOff += 1;
      result.rows.push({ outboxId: row.id, status: "skipped_toggle_off" });
      continue;
    }

    const { data: targets, error: resolveError } = await client.rpc("resolve_outbox_dispatch", {
      p_outbox_id: row.id,
    });
    if (resolveError) {
      await recordFailure(client, row.id, resolveError.message);
      result.failed += 1;
      result.rows.push({ outboxId: row.id, status: "failed", error: resolveError.message });
      continue;
    }

    // Delivery is tracked per TARGET, not per row. One outbox row fans out to
    // one message per recipient whenever the company has no WhatsApp group id
    // (resolve_outbox_dispatch's per-user fallback), and the row is only
    // finished when every one of them has landed. Judging the row as a whole
    // meant a single unreachable number sent every other recipient a fresh
    // copy on each retry — see migration 0038 for the full write-up.
    const alreadySent = new Set(row.sent_targets ?? []);
    const resolvedTargets = (targets ?? []) as DispatchTarget[];
    const errors: string[] = [];

    for (const { target, message } of resolvedTargets) {
      // Delivered on an earlier pass — skipping is the whole point of the fix.
      if (alreadySent.has(target)) continue;

      const sendResult = await channel.send({ to: target, body: message });
      if (!sendResult.success) {
        errors.push(sendResult.error ?? `send to ${target} failed`);
        continue;
      }

      alreadySent.add(target);

      // Recorded immediately, one target at a time, rather than batched at the
      // end: if this process dies mid-fan-out, everything already delivered is
      // durably marked and the next pass resumes from there instead of
      // starting the whole row over.
      const { error: recordError } = await client.rpc("record_outbox_target_sent", {
        p_outbox_id: row.id,
        p_target: target,
        p_complete: false,
      });
      if (recordError) errors.push(recordError.message);
    }

    if (errors.length === 0) {
      // Completion is stamped once, after the loop, from "nothing failed" —
      // deliberately NOT from "this was the last target". resolve_outbox_dispatch's
      // per-user branch has no ORDER BY, so the target order can differ between
      // passes; a completion flag hung off the final iteration would be missed
      // whenever the last target was one already delivered and skipped, leaving
      // the row pending forever with nothing left to send. Judging it after the
      // whole loop is order-independent.
      //
      // The empty target carries only the flag — the function ignores a blank
      // target for the sent_targets list, so this also covers the two cases
      // where the loop sent nothing: every target already delivered, and a row
      // that resolved to no targets at all (a company with no group id and no
      // phone numbers on file), which otherwise would never stop being retried.
      const { error: completeError } = await client.rpc("record_outbox_target_sent", {
        p_outbox_id: row.id,
        p_target: "",
        p_complete: true,
      });
      if (completeError) {
        await recordFailure(client, row.id, completeError.message);
        result.failed += 1;
        result.rows.push({ outboxId: row.id, status: "failed", error: completeError.message });
        continue;
      }
      result.sent += 1;
      result.rows.push({ outboxId: row.id, status: "sent" });
    } else {
      const combined = errors.join("; ");
      await recordFailure(client, row.id, combined);
      result.failed += 1;
      result.rows.push({ outboxId: row.id, status: "failed", error: combined });
    }
  }

  return result;
}

// Increments through a Postgres function rather than a select-then-update.
// Reading attempt_count and writing back value + 1 loses an increment whenever
// two drain passes overlap (a slow run still going when the schedule fires the
// next one): both read N, both write N + 1, and a permanently failing row
// never reaches maxAttempts. The function does the arithmetic from the
// column's own value in one statement — R7, concurrency is the database's job.
async function recordFailure(client: SupabaseClient, outboxId: string, error: string): Promise<void> {
  await client.rpc("record_outbox_attempt", { p_outbox_id: outboxId, p_error: error });
}
