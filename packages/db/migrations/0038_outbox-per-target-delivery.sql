-- Fixes a duplicate-delivery bug in the notification drain, and the
-- lost-update race in its own retry bookkeeping.
--
-- THE BUG. One notification_outbox row does not mean one message.
-- resolve_outbox_dispatch (0024) returns one row PER RECIPIENT whenever the
-- recipient company has no whatsapp_group_id — the documented per-user
-- fallback, "a company with no whatsapp_group_id falls back to messaging each
-- user directly" (0023). The drain sent to each target in turn and then judged
-- the outbox row as a whole: if ANY target failed, the row was recorded as
-- failed, sent_at stayed null, and the next drain pass re-sent the message to
-- EVERY target again — including the ones that had already received it.
--
-- So one permanently unreachable phone number in a five-person company meant
-- the other four got the same WhatsApp message once per drain pass until
-- attempt_count hit MAX_ATTEMPTS: five copies of "the daily arrangement has
-- closed" for a single close_arrangement. This is the same double-send failure
-- the outbox was introduced to eliminate (docs/ARCHITECTURE.md § pg-boss),
-- reappearing one level down at per-target granularity rather than per-row.
--
-- THE FIX. Record delivery per target, not per row. sent_targets accumulates
-- the targets that have actually been handed off successfully; the drain skips
-- any target already in it, so a retry only ever contacts recipients who have
-- not yet received this message. sent_at keeps its existing meaning — the row
-- is finished — and is now set exactly when every resolved target is accounted
-- for.
--
-- THE RACE, fixed at the same time because it lives in the same read-modify-
-- write. The drain incremented attempt_count by SELECTing it and writing back
-- value + 1. Two overlapping drain passes (a slow run still going when the
-- schedule fires the next one) both read N and both write N + 1, so failures
-- undercount and a dead row is retried past MAX_ATTEMPTS forever. R7 says
-- concurrency is the database's job: both functions below mutate the column
-- from its own current value inside a single statement, under a row lock, so
-- the arithmetic cannot be lost. They are the only supported way to write this
-- bookkeeping — the drain no longer updates these columns directly.

alter table "public"."notification_outbox"
  add column "sent_targets" text[] not null default '{}';

comment on column "public"."notification_outbox"."sent_targets" is
  'Targets (WhatsApp group id, or 972-prefixed msisdn) this row has already been delivered to successfully. Appended one at a time by record_outbox_target_sent. The drain skips any target listed here, so retrying a row that partially failed never re-sends to a recipient who already got the message.';

comment on column "public"."notification_outbox"."sent_at" is
  'Set once every target resolve_outbox_dispatch returned for this row has been delivered to. A row with a non-empty sent_targets but a null sent_at is a partial delivery awaiting retry.';

-- Appends one delivered target and, when the caller reports that this
-- completed the row, stamps sent_at.
--
-- SECURITY: security invoker, deliberately — this function must NOT carry its
-- own privilege. It runs as whoever called it, so the UPDATE inside is subject
-- to the authorization notification_outbox already has (0020): the
-- "notification_outbox_backoffice" policy, which permits the row only when
-- public.current_role() = 'backoffice'. That allows exactly the two callers
-- that should reach it and nobody else — the Edge Function drain, whose
-- service-role key bypasses RLS by design, and a backoffice-session Node
-- caller of drainNotificationOutbox. A signed-in customer or grower calling
-- this directly updates zero rows, because the policy filters their target row
-- away; there is nothing here for them to abuse.
--
-- security definer would have broken that: it would let any authenticated user
-- mark a notification delivered, suppressing a message the distributor
-- believes went out. The wrapper adds no privilege, only atomicity.
--
-- search_path is still pinned: an unqualified name inside a function is
-- resolved against the CALLER's search_path unless set here, which is the
-- standard shadowing risk regardless of invoker/definer.
create or replace function public.record_outbox_target_sent(
  p_outbox_id uuid,
  p_target text,
  p_complete boolean default false
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.notification_outbox
  set
    -- Reads the column's own current value inside the UPDATE, so concurrent
    -- appends both land instead of one overwriting the other. Guarded so a
    -- retry of the same target cannot list it twice, and so the
    -- completion-only call (a row that resolved to no targets at all, or whose
    -- targets were all delivered on an earlier pass) can pass an empty target
    -- to stamp sent_at without polluting the list.
    sent_targets = case
      when p_target is null or p_target = '' then sent_targets
      when p_target = any (sent_targets) then sent_targets
      else array_append(sent_targets, p_target)
    end,
    last_attempted_at = now(),
    sent_at = case when p_complete then coalesce(sent_at, now()) else sent_at end
  where id = p_outbox_id;
$$;

comment on function public.record_outbox_target_sent(uuid, text, boolean) is
  'The drain job (service-role, or a backoffice session). security invoker, so notification_outbox''s own backoffice-only RLS policy is what authorizes the write. Records one successful per-target delivery, idempotently, and stamps sent_at when p_complete says the row has no targets left. The append reads the column''s own value inside the UPDATE, so overlapping drain passes cannot lose each other''s writes.';

grant execute on function public.record_outbox_target_sent(uuid, text, boolean) to authenticated, service_role;

-- Increments attempt_count and records the error. Replaces the drain's
-- select-then-update, which lost increments under concurrent passes.
--
-- SECURITY: security invoker, for the same reason as above — the write is
-- authorized by notification_outbox's backoffice-only RLS policy, not by this
-- function. That matters here specifically: attempt_count >= MAX_ATTEMPTS is
-- what makes the drain stop picking a row up, so a definer-rights version
-- would let any signed-in user burn another company's retry budget and
-- silently cancel a notification they were never allowed to see.
create or replace function public.record_outbox_attempt(
  p_outbox_id uuid,
  p_error text
)
returns integer
language sql
security invoker
set search_path = public
as $$
  update public.notification_outbox
  set
    attempt_count = attempt_count + 1,
    last_error = p_error,
    last_attempted_at = now()
  where id = p_outbox_id
  returning attempt_count;
$$;

comment on function public.record_outbox_attempt(uuid, text) is
  'The drain job (service-role, or a backoffice session). security invoker, so notification_outbox''s own backoffice-only RLS policy authorizes the write. Increments attempt_count from its own current value in a single statement — so two overlapping drain passes cannot both read N and both write N+1 — and records the failure reason. Returns the new attempt count.';

grant execute on function public.record_outbox_attempt(uuid, text) to authenticated, service_role;
