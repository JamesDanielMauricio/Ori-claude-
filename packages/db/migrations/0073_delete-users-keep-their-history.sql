-- Staff can delete a user who has history, as in Bubble (James's decision,
-- 2026-11-07).
--
-- Deleting a user (the Users screen's delete: apps/api deleteUser -> the
-- Supabase Admin API) removes their login, and with it their profile
-- (profiles.user_id is ON DELETE CASCADE, 0001). But four history tables
-- point at the profile of whoever did something, with Postgres's default rule
-- (NO ACTION) — so the delete was refused for anyone who had ever sent an
-- order, started a trading day, opened the shop or performed a day action: 17
-- customers and 1 staff account on 2026-11-06, and there was no other way to
-- take away their access. Bubble had no such rule: deleting a user just left
-- the records that named them without a name.
--
-- James chose Bubble's behaviour. The user is deleted; their history stays,
-- with the "who" left empty:
--   order_submission_logs.submitted_by  — who sent an order
--   trading_days.initiated_by           — who started the trading day
--   daily_shops.opened_by               — who opened the shop
--   lifecycle_sessions.performed_by     — who performed a day action
-- Every order, line, quantity, price, snapshot and time stays exactly as it
-- was; only the person's name is gone from these four columns.
--
-- Nothing in the app reads these columns. The five functions that write them
-- (initiate_business_day, open_shop, close_shop, close_arrangement,
-- submit_order) always write the signed-in caller, which is unchanged — new
-- rows are still attributed. Safe to run more than once.

-- SECURITY: each rule below ALLOWS a user to be deleted even though history
-- points at them, by emptying the pointer. It is SET NULL, never CASCADE: it
-- PROTECTS AGAINST deleting a person ever deleting what they did — an order
-- sent, a day opened — which stays for everyone who reads it. What is given
-- up, by James's choice, is the name on those records: after the delete, the
-- audit trail (order_submission_logs) shows what was sent and when, but no
-- longer by whom. Who may delete a user is unchanged: backoffice only
-- (apps/api's backofficeProcedure).
alter table public.order_submission_logs
  alter column submitted_by drop not null,
  drop constraint if exists order_submission_logs_submitted_by_fkey,
  add constraint order_submission_logs_submitted_by_fkey
    foreign key (submitted_by) references public.profiles(user_id) on delete set null;

alter table public.trading_days
  alter column initiated_by drop not null,
  drop constraint if exists trading_days_initiated_by_fkey,
  add constraint trading_days_initiated_by_fkey
    foreign key (initiated_by) references public.profiles(user_id) on delete set null;

alter table public.daily_shops
  alter column opened_by drop not null,
  drop constraint if exists daily_shops_opened_by_fkey,
  add constraint daily_shops_opened_by_fkey
    foreign key (opened_by) references public.profiles(user_id) on delete set null;

alter table public.lifecycle_sessions
  alter column performed_by drop not null,
  drop constraint if exists lifecycle_sessions_performed_by_fkey,
  add constraint lifecycle_sessions_performed_by_fkey
    foreign key (performed_by) references public.profiles(user_id) on delete set null;

comment on column public.order_submission_logs.submitted_by is
  'Who sent this order (the caller of submit_order). Empty once that user has been deleted — the record stays, without the name (migration 0073, as in Bubble).';
comment on column public.trading_days.initiated_by is
  'Who started this trading day. Empty once that user has been deleted (migration 0073).';
comment on column public.daily_shops.opened_by is
  'Who opened this day''s shop. Empty once that user has been deleted (migration 0073).';
comment on column public.lifecycle_sessions.performed_by is
  'Who performed this day action. Empty once that user has been deleted (migration 0073).';
