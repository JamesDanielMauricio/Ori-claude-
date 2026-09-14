-- THE BUG. whatsapp-dispatch's eligibility check (whatsapp_enabled /
-- close_arrangement_whatsapp_enabled) only ever gated THIS pass: a row
-- found ineligible was skipped with no bookkeeping at all, so attempt_count
-- stayed untouched and the exact same row was re-evaluated on every future
-- drain — instant nudge or the 10-minute cron alike. The first drain after
-- the toggle happened to be back on sent it, no matter how much later that
-- was or how unrelated the click that triggered that drain. Reported
-- symptom: disable WhatsApp, send a reminder (correctly nothing arrives),
-- re-enable WhatsApp, send a DIFFERENT reminder — two messages arrive, one
-- of them from the disabled period. A toggle being off should mean that
-- message never goes out, not "goes out eventually, whenever it's back on."
--
-- THE FIX. Abandon the row the first time it's found ineligible, the same
-- way a row that has genuinely failed 5 times already gets abandoned:
-- reuses attempt_count/last_error (record_outbox_attempt, migration 0038)
-- rather than adding a new column. Setting attempt_count straight to the
-- dispatch function's own MAX_ATTEMPTS (passed in by the caller, so the two
-- values can never drift apart) drops the row out of the pending query
-- (`attempt_count < MAX_ATTEMPTS`) in one step instead of five — there is
-- nothing to retry here, since the toggle being off isn't a transient
-- failure that might resolve itself. sent_at stays null: this row was
-- never delivered, which is exactly what distinguishes it from a real send
-- when read back later — last_error says why.
create or replace function public.record_outbox_skipped(
  p_outbox_id uuid,
  p_max_attempts integer,
  p_reason text
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.notification_outbox
  set
    attempt_count = p_max_attempts,
    last_error = p_reason,
    last_attempted_at = now()
  where id = p_outbox_id;
$$;

comment on function public.record_outbox_skipped(uuid, integer, text) is
  'Permanently abandons a notification_outbox row that was ineligible to send because whatsapp_enabled/close_arrangement_whatsapp_enabled was off at drain time. Sets attempt_count to p_max_attempts (whatsapp-dispatch''s own MAX_ATTEMPTS) so the row is never retried, even after the toggle is switched back on. sent_at stays null — never delivered, distinguished from a real send by last_error.';

grant execute on function public.record_outbox_skipped(uuid, integer, text) to authenticated, service_role;
