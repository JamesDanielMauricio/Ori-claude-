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
}

interface NotificationSettingsRow {
  whatsapp_enabled: boolean;
  close_arrangement_whatsapp_enabled: boolean;
}

interface DispatchTarget {
  target: string;
  message: string;
}

const DEFAULT_MAX_ATTEMPTS = 5;

function isEligible(templateKey: string, settings: NotificationSettingsRow): boolean {
  if (!settings.whatsapp_enabled) return false;
  if (templateKey.startsWith("close_arrangement") && !settings.close_arrangement_whatsapp_enabled) return false;
  return true;
}

export async function drainNotificationOutbox(deps: DrainDeps): Promise<DrainResult> {
  const { client, channel } = deps;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const { data: settingsRow, error: settingsError } = await client
    .from("notification_settings")
    .select("whatsapp_enabled, close_arrangement_whatsapp_enabled")
    .single();
  if (settingsError) throw settingsError;
  const settings = settingsRow as NotificationSettingsRow;

  const { data: pendingRows, error: pendingError } = await client
    .from("notification_outbox")
    .select("id, template_key")
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

    const errors: string[] = [];
    for (const { target, message } of (targets ?? []) as DispatchTarget[]) {
      const sendResult = await channel.send({ to: target, body: message });
      if (!sendResult.success) {
        errors.push(sendResult.error ?? `send to ${target} failed`);
      }
    }

    if (errors.length === 0) {
      await client
        .from("notification_outbox")
        .update({ sent_at: new Date().toISOString(), last_attempted_at: new Date().toISOString() })
        .eq("id", row.id);
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

async function recordFailure(client: SupabaseClient, outboxId: string, error: string): Promise<void> {
  const { data: current } = await client.from("notification_outbox").select("attempt_count").eq("id", outboxId).single();
  const attemptCount = ((current as { attempt_count: number } | null)?.attempt_count ?? 0) + 1;
  await client
    .from("notification_outbox")
    .update({ attempt_count: attemptCount, last_error: error, last_attempted_at: new Date().toISOString() })
    .eq("id", outboxId);
}
