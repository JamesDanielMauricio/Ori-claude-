-- A customer's ranking score: the distributor's own scale — 1 (lowest) to 5,
-- worked out by them from payment record, order frequency, price and the
-- rest, and entered here as the one figure that comes out of that. Kept so
-- that an arrangement suggestion can order customers by it when a product is
-- short; nothing reads it for that yet.
--
-- ITS OWN TABLE, not a column on companies, and that is the whole design.
-- companies_select_own (0003) lets every customer user read their own
-- company row — right for a name and a pickup time, and exactly wrong for
-- the one fact about a customer that the customer must never see: how the
-- distributor ranks them against the others. RLS is per row, not per column,
-- so a score column on that row would be readable by its own subject however
-- the screens were written. Here the row itself is the secret, and the only
-- policies on it are backoffice's.
--
-- One row per ranked customer. No row means unranked — a real state ("חסר
-- דירוג"), which an arrangement treats as the lowest rank; it is not a score
-- of zero, and the range check below is why it cannot be mistaken for one.
--
-- No live-updates broadcast trigger, for the reason 0061 gives for the rest
-- of the reference data: nobody needs a ranking the instant it changes.
--
-- Written to be re-run. This database has been migrated by hand as often as
-- by drizzle-kit, so every statement here is safe to apply twice.

create table if not exists "public"."customer_scores" (
  "customer_company_id" uuid primary key references "public"."companies"("id") on delete cascade,
  "general_score" numeric(3, 2) not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "customer_scores_general_score_range" check ("general_score" >= 1 and "general_score" <= 5)
);

comment on table "public"."customer_scores" is
  'The distributor''s ranking score for a customer company, 1 (lowest) to 5. Backoffice-only: never readable by the customer it describes, which is why it is not a column on companies. No row = unranked.';

alter table public.customer_scores enable row level security;
alter table public.customer_scores force row level security;

grant select, insert, update, delete on public.customer_scores to authenticated;

-- Backoffice reads and writes every row. There is deliberately no
-- "_select_own" beside these, unlike product_customer_caps (0006): this is
-- the table whose rows their subject does not get to see.
drop policy if exists "customer_scores_select_backoffice" on public.customer_scores;
create policy "customer_scores_select_backoffice" on public.customer_scores
  for select
  to authenticated
  using ((select public.current_role()) = 'backoffice');

drop policy if exists "customer_scores_write_backoffice" on public.customer_scores;
create policy "customer_scores_write_backoffice" on public.customer_scores
  for all
  to authenticated
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- set_customer_score — one customer's score, set or cleared in one call. An
-- RPC rather than a plain upsert for the reason save_customer (0007) is one:
-- a single call site for the backoffice check and for the rules a bare
-- write would not enforce — that the company is a customer at all, and that
-- clearing a score removes the row instead of storing a placeholder.
--
-- Separate from save_customer on purpose. That function saves the row a
-- customer can read; this saves the one they cannot. Folding the score into
-- it would also have meant a new parameter on a function every deployed
-- client already calls: required, and those clients stop being able to save
-- a customer at all; optional, and each of their saves reads as "no score"
-- and clears it.
--
-- The checks here are this function's, not the table's: a backoffice session
-- writing customer_scores directly is held only to the 1-to-5 range (after
-- the column rounds) and to the company existing. That is the same trust
-- every *_write_backoffice policy in this schema extends; the app itself
-- only ever writes through here.
create or replace function public.set_customer_score(
  p_customer_company_id uuid,
  p_general_score numeric
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- `is distinct from`, not `<>`: a caller with no profile has a NULL role,
  -- and NULL <> 'backoffice' is not true. RLS would still refuse the write
  -- below; this refuses it by name first.
  if public.current_role() is distinct from 'backoffice' then
    raise exception 'FORBIDDEN: backoffice role required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.companies
    where id = p_customer_company_id and type = 'customer'
  ) then
    raise exception 'NOT_FOUND: customer company % does not exist', p_customer_company_id using errcode = 'P0002';
  end if;

  if p_general_score is null then
    delete from public.customer_scores where customer_company_id = p_customer_company_id;
    return;
  end if;

  if p_general_score < 1 or p_general_score > 5 then
    raise exception 'INVALID_INPUT: a ranking score is between 1 and 5, got %', p_general_score using errcode = 'P0008';
  end if;

  insert into public.customer_scores (customer_company_id, general_score)
  values (p_customer_company_id, p_general_score)
  on conflict (customer_company_id)
  do update set general_score = excluded.general_score, updated_at = now();
end;
$$;

comment on function public.set_customer_score(uuid, numeric) is
  'Backoffice-only. Sets a customer company''s ranking score (1 to 5), or clears it when p_general_score is null. Raises 42501 for a non-backoffice caller, P0002 if the company does not exist or is not a customer, P0008 for a score outside 1 to 5.';

-- SECURITY: ALLOWS signed-in users (`authenticated`) and the service role to
-- call it — the function itself then refuses everyone but backoffice, and
-- being SECURITY INVOKER it writes through the caller's own RLS, so the
-- table's backoffice-only write policy stands behind that refusal.
-- PROTECTS AGAINST anonymous callers reaching it at all: Postgres grants
-- EXECUTE on every new function to PUBLIC, and Supabase's default privileges
-- add `anon`, so both are revoked here (the same reasoning as 0055's revoke
-- on enqueue_backoffice_notification, and 0059's and 0062's since).
-- And the table: ALLOWS backoffice to read and write every score. PROTECTS
-- AGAINST every other session reading any — a customer's own included — by
-- having no policy that admits them; a grant without a policy reads nothing.
revoke execute on function public.set_customer_score(uuid, numeric) from public, anon;
grant execute on function public.set_customer_score(uuid, numeric) to authenticated, service_role;
