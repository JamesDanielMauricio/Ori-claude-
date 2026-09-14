-- Safety-net schedule for the WhatsApp outbox drain — backs up the instant
-- client-side nudge (apps/web/src/lib/nudge-whatsapp-dispatch.ts) for the
-- rare case it doesn't fire (the tab closes mid-request, a network hiccup).
-- Safe to run this often: whatsapp-dispatch only ever touches
-- notification_outbox rows where sent_at is still null (see its own query,
-- `.is("sent_at", null)`), so a row the nudge already delivered is silently
-- skipped here, never re-sent. In the common case this job finds nothing to
-- do and is a no-op every single time it fires.
--
-- pg_cron only SCHEDULES a plain SQL command — it can't make an HTTP call by
-- itself, so pg_net (Postgres's own outbound-HTTP extension) does the actual
-- call to the Edge Function's URL, the same way the app or a human running
-- `curl` would.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- SECURITY: the Authorization header below reads the service-role key from
-- Supabase Vault (vault.decrypted_secrets) by NAME, never as a literal value
-- in this file. A migration is a permanent, git-committed artifact — the
-- key itself must never be written into one. Before running this migration,
-- store the key once via the Supabase SQL Editor (not committed to the
-- repo):
--
--   select vault.create_secret(
--     '<paste SUPABASE_SERVICE_ROLE_KEY from your .env here>',
--     'whatsapp_dispatch_service_role_key'
--   );
--
-- If that secret doesn't exist yet when this job runs, the Authorization
-- header is malformed and every call fails with 401 — annoying (check
-- `select * from net._http_response order by created desc limit 5;` to see
-- it) but harmless: the same "nothing gets re-sent, nothing gets lost"
-- guarantee above still holds, since a failed call never touches the outbox
-- at all.
select cron.schedule(
  'whatsapp-dispatch-safety-net',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://zvzqfjrxknxigddkwlir.supabase.co/functions/v1/whatsapp-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'whatsapp_dispatch_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
