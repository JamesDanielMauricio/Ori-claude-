-- R7: RLS gates on the reference-data tables. Two changes to what 0003
-- established, plus new-table baselines:
--
-- 1. `companies` loses its blanket "any authenticated user reads every
--    row" policy. That was fine as a placeholder when the table held
--    nothing but a name, but now that it holds every grower/customer/
--    transporter's real record, it's exactly the cross-tenant leak
--    company.md warns about ("A leak across companies... is a critical
--    bug"). Replaced with backoffice-reads-all (already covered by the
--    existing FOR ALL write policy) plus a new self-row read.
-- 2. `profiles` gets a backoffice UPDATE policy — the Users management
--    screen needs to edit another user's role/display name/company,
--    which the existing self-only update policy doesn't permit.
--
-- `current_company_id()` mirrors `current_role()` (same SECURITY DEFINER
-- reasoning: called from inside other tables' policies, must not recurse
-- into profiles' own RLS evaluation).
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where user_id = (select auth.uid())
$$;

comment on function public.current_company_id() is
  'The calling user''s profiles.company_id, looked up via auth.uid(). Use inside RLS policies that scope a row to "my own company" — e.g. a Grower reading their own company record.';

-- 1. companies
drop policy "companies_select_authenticated" on public.companies;

create policy "companies_select_own" on public.companies
  for select
  to authenticated
  using (id = public.current_company_id());

-- 2. profiles
create policy "profiles_update_backoffice" on public.profiles
  for update
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 3. product_families — same shape as product_varieties: shared,
--    non-tenant-scoped reference data everyone needs to read (growers
--    picking, customers ordering both resolve through the catalog), only
--    backoffice writes.
alter table public.product_families enable row level security;
alter table public.product_families force row level security;

grant select, insert, update, delete on public.product_families to authenticated;

create policy "product_families_select_authenticated" on public.product_families
  for select
  to authenticated
  using (true);

create policy "product_families_write_backoffice" on public.product_families
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 4. grower_products — a grower reads their own selection; backoffice
--    reads/writes all; no one else needs it yet (the day's bootstrap runs
--    through the trusted db connection, not RLS).
alter table public.grower_products enable row level security;
alter table public.grower_products force row level security;

grant select, insert, update, delete on public.grower_products to authenticated;

create policy "grower_products_select_own" on public.grower_products
  for select
  to authenticated
  using (company_id = public.current_company_id());

create policy "grower_products_select_backoffice" on public.grower_products
  for select
  to authenticated
  using (public.current_role() = 'backoffice');

create policy "grower_products_write_backoffice" on public.grower_products
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');

-- 5. product_customer_caps — same shape: the specific customer reads their
--    own caps; backoffice reads/writes all.
alter table public.product_customer_caps enable row level security;
alter table public.product_customer_caps force row level security;

grant select, insert, update, delete on public.product_customer_caps to authenticated;

create policy "product_customer_caps_select_own" on public.product_customer_caps
  for select
  to authenticated
  using (customer_company_id = public.current_company_id());

create policy "product_customer_caps_select_backoffice" on public.product_customer_caps
  for select
  to authenticated
  using (public.current_role() = 'backoffice');

create policy "product_customer_caps_write_backoffice" on public.product_customer_caps
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');
