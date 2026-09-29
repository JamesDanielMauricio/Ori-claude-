-- Live updates for every screen: whenever a table the app shows changes, the
-- database says so on one private Realtime channel, "live-updates", and every
-- signed-in device that has the app open re-reads whatever it has on screen
-- (apps/web/src/lib/live-updates.ts).
--
-- Not Supabase's "Postgres Changes" (0019, 0041), which sends one message per
-- changed ROW to every listening device: starting one day writes ~200 rows
-- (the day, 26 pick lists, 172 pick lines — counted on 2026-09-30's day), so
-- 20 open devices would be sent ~4,000 messages for one click. Here a whole
-- TRANSACTION sends ONE message, however many rows and tables it wrote — a
-- save of 20 pick lines is one message, starting a day is one message — and
-- the message carries no row data, so there is nothing to check per device
-- and nothing private to leak.
--
-- Cost (Supabase billing docs, checked 2026-09-29): a broadcast counts as 1
-- message sent + 1 per device listening, against 2M (Free) / 5M (Pro)
-- included a month and 100 (Free) / 500 (Pro) per second. A device listens
-- only while the app is on screen (a background tab or locked phone doesn't).
-- At the busiest month on record (July 2025, ~50 saves a day) even ~20
-- devices listening all day would be ~30,000 messages a month.
--
-- The supabase_realtime publication (0019, 0041) is left as it is. With the
-- web app no longer subscribing to Postgres Changes it costs nothing, and
-- dropping it is a separate decision.

-- One function behind every table's trigger below. It sends
-- {"table": "<name>"} as event "changed" on topic "live-updates", naming the
-- first table the transaction wrote (for debugging; clients don't read it).
--
-- SECURITY DEFINER because of who is writing. Most writes arrive as the
-- signed-in user — the lifecycle functions are security invoker (0059), and
-- some screens write straight through PostgREST — and realtime.send is a plain
-- function that INSERTs into realtime.messages as whoever calls it. That
-- table has RLS with no INSERT policy for any app role, so as the user the
-- insert would be refused, and realtime.send turns every failure into a
-- WARNING: nothing would ever be sent, and nothing would say so. Running as
-- the owner (postgres, which bypasses RLS) is what lets the send through.
--
-- SECURITY: ALLOWS the database itself to put one "something changed" message
-- on the live-updates topic. PROTECTS AGAINST that being a way for a user to
-- send messages: a function returning `trigger` can only be run BY a trigger —
-- calling it directly is an error, and PostgREST does not expose it as an RPC
-- — so no caller can choose what it sends or where. `set search_path = ''`
-- (every name below is schema-qualified) stops anyone who can create objects
-- from planting a look-alike function this owner-privileged code would call.
--
-- Once per transaction. A lifecycle function writes several tables in many
-- statements (one per grower, one per line), and clients refresh everything
-- on screen whichever table changed, so any message after the first in the
-- same transaction would only be cost. The "already sent" marker is a setting
-- holding the current transaction's id — not a SET LOCAL flag, because
-- Postgres undoes a SET LOCAL made inside a function that has its own SET
-- clause (the search_path above) the moment the function returns. A
-- session-level setting survives that; keying it to the transaction id means
-- a pooled connection's next transaction never mistakes an old marker for its
-- own.
--
-- The message is only delivered once the transaction COMMITS (Realtime reads
-- realtime.messages from the replication stream), so a device never refreshes
-- to data that isn't there yet, and a rolled-back write sends nothing.
--
-- Statement-level triggers also fire for an UPDATE or DELETE that matched no
-- rows. That sends a message for no change — harmless (devices re-read and
-- find nothing new) and rare, so not worth a transition table per event on
-- every table to rule out.
create or replace function public.broadcast_table_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction text := pg_catalog.pg_current_xact_id()::text;
begin
  if pg_catalog.current_setting('ori.live_updates_sent_in', true) = v_transaction then
    return null;
  end if;
  perform pg_catalog.set_config('ori.live_updates_sent_in', v_transaction, false);

  perform realtime.send(
    pg_catalog.jsonb_build_object('table', tg_table_name),
    'changed',
    'live-updates',
    true -- private: only receivers the policy below admits
  );
  return null;
end;
$$;

-- Every table a screen reads that can change while someone is looking at it.
-- Left out on purpose: notification_outbox (no screen reads it, and the
-- WhatsApp dispatcher updates it every few minutes — it would make every
-- device refresh for nothing), order_submission_logs and lifecycle_sessions
-- (no screen reads them), alert_types and notification_templates (fixed
-- reference rows), and the _bubble_migration_* tables.
create trigger trading_days_broadcast_changed
after insert or update or delete on public.trading_days
for each statement execute function public.broadcast_table_changed();

create trigger daily_shops_broadcast_changed
after insert or update or delete on public.daily_shops
for each statement execute function public.broadcast_table_changed();

create trigger daily_picks_broadcast_changed
after insert or update or delete on public.daily_picks
for each statement execute function public.broadcast_table_changed();

create trigger daily_pick_products_broadcast_changed
after insert or update or delete on public.daily_pick_products
for each statement execute function public.broadcast_table_changed();

create trigger daily_orders_broadcast_changed
after insert or update or delete on public.daily_orders
for each statement execute function public.broadcast_table_changed();

create trigger daily_order_products_broadcast_changed
after insert or update or delete on public.daily_order_products
for each statement execute function public.broadcast_table_changed();

create trigger daily_arrangements_broadcast_changed
after insert or update or delete on public.daily_arrangements
for each statement execute function public.broadcast_table_changed();

create trigger arrangement_records_broadcast_changed
after insert or update or delete on public.arrangement_records
for each statement execute function public.broadcast_table_changed();

create trigger alerts_broadcast_changed
after insert or update or delete on public.alerts
for each statement execute function public.broadcast_table_changed();

create trigger companies_broadcast_changed
after insert or update or delete on public.companies
for each statement execute function public.broadcast_table_changed();

create trigger profiles_broadcast_changed
after insert or update or delete on public.profiles
for each statement execute function public.broadcast_table_changed();

create trigger product_families_broadcast_changed
after insert or update or delete on public.product_families
for each statement execute function public.broadcast_table_changed();

create trigger product_varieties_broadcast_changed
after insert or update or delete on public.product_varieties
for each statement execute function public.broadcast_table_changed();

create trigger grower_products_broadcast_changed
after insert or update or delete on public.grower_products
for each statement execute function public.broadcast_table_changed();

create trigger product_customer_caps_broadcast_changed
after insert or update or delete on public.product_customer_caps
for each statement execute function public.broadcast_table_changed();

create trigger profile_blocked_products_broadcast_changed
after insert or update or delete on public.profile_blocked_products
for each statement execute function public.broadcast_table_changed();

create trigger notification_settings_broadcast_changed
after insert or update or delete on public.notification_settings
for each statement execute function public.broadcast_table_changed();

-- SECURITY: ALLOWS any signed-in user to join the private "live-updates"
-- channel and receive its broadcasts. What they receive is only ever the NAME
-- of a table that just changed — never a row, an id or a value — which every
-- user may know: it is what the refresh it triggers would show them anyway,
-- through their own RLS. The same rule is what lets a device, as it joins,
-- have Realtime re-deliver ("replay") the last minute's messages on this
-- topic, so a save made while it was connecting isn't missed — table names
-- again, nothing more. PROTECTS AGAINST two things. Signed-out visitors:
-- the anon key ships in every bundle, so on a public channel anyone could
-- watch the business's activity; `to authenticated` keeps them out. And
-- forged messages: there is deliberately NO insert policy, so no client can
-- send on this topic (or any other) — only broadcast_table_changed above,
-- running as the owner, can. The topic and extension checks keep this policy
-- from opening any other channel, or presence on this one.
create policy live_updates_receive_authenticated
on realtime.messages
for select
to authenticated
using (
  (select realtime.topic()) = 'live-updates'
  and realtime.messages.extension = 'broadcast'
);
