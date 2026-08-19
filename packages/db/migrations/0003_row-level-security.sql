-- R7: Row Level Security is the primary authorization layer, not app-level
-- middleware. This establishes the pattern — a role-lookup helper plus
-- baseline self/backoffice policies — that later prompts extend with
-- table-specific business rules as each module's data lands.
--
-- Enforcement note: RLS only applies to connections using the `anon` /
-- `authenticated` Postgres roles (i.e. requests through Supabase's
-- PostgREST/supabase-js layer, using a user's own JWT). Our own backend
-- (packages/db's Drizzle client, connecting directly as the Postgres
-- superuser) always bypasses RLS by Postgres design — that's an
-- intentionally separate trust boundary, authorized by its own explicit
-- checks (see apps/api/src/trpc.ts's requireRole), not by these policies.
-- See docs/SCHEMA_DECISIONS.md.

-- 1. current_role(): reads the CALLING user's app-level role via auth.uid().
--    SECURITY DEFINER is required, not incidental — a caller's own RLS
--    policy on `profiles` (see below) would otherwise recurse into itself
--    when this function is invoked from within another table's policy.
--    Running as the function owner (bypassing RLS for this one lookup)
--    breaks that recursion. `set search_path` is pinned for the same
--    reason every SECURITY DEFINER function should pin it: prevents a
--    caller from shadowing `profiles` with an object earlier in their own
--    search_path.
create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = (select auth.uid())
$$;

comment on function public.current_role() is
  'The calling user''s profiles.role, looked up via auth.uid(). Use inside RLS policies that need to distinguish backoffice from grower/customer. Schema-qualify as public.current_role() — do not confuse with the built-in CURRENT_ROLE keyword, which returns the Postgres session role instead.';

-- 2. profiles — baseline pattern: a user can read/update their own row;
--    only backoffice can read other users' rows.
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

grant select, update on public.profiles to authenticated;

create policy "profiles_select_own" on public.profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "profiles_select_backoffice" on public.profiles
  for select
  to authenticated
  using (public.current_role() = 'backoffice');

create policy "profiles_update_own" on public.profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 3. companies — minimal placeholder table (see company.ts), but RLS is
--    enabled now so it isn't a gap later: every authenticated user can read
--    the tenant list (needed broadly, e.g. to resolve a display name), only
--    backoffice can write. Table-specific refinement is the reference-data
--    module's job.
alter table public.companies enable row level security;
alter table public.companies force row level security;

grant select, insert, update, delete on public.companies to authenticated;

create policy "companies_select_authenticated" on public.companies
  for select
  to authenticated
  using (true);

create policy "companies_write_backoffice" on public.companies
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 4. product_varieties — same shape as companies: readable catalog,
--    backoffice-only writes. Full ownership lands with the reference-data
--    module.
alter table public.product_varieties enable row level security;
alter table public.product_varieties force row level security;

grant select, insert, update, delete on public.product_varieties to authenticated;

create policy "product_varieties_select_authenticated" on public.product_varieties
  for select
  to authenticated
  using (true);

create policy "product_varieties_write_backoffice" on public.product_varieties
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 5. profile_blocked_products — a user can see their own blocklist;
--    backoffice has full access. Which entity should ultimately own this
--    gate is still an open product question (see
--    profile-blocked-product.ts) — this is only the access-control
--    baseline.
alter table public.profile_blocked_products enable row level security;
alter table public.profile_blocked_products force row level security;

grant select, insert, update, delete on public.profile_blocked_products to authenticated;

create policy "profile_blocked_products_select_own" on public.profile_blocked_products
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "profile_blocked_products_write_backoffice" on public.profile_blocked_products
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');
