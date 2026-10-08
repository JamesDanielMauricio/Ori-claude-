-- Security policies ask "who is signed in?" once per query instead of once per
-- row. WHO may read or change WHAT stays exactly as it was.
--
-- 41 row-level security policies call public.current_role() or
-- public.current_company_id() bare, e.g.
--
--   using (grower_company_id = public.current_company_id())
--
-- Postgres runs a function written that way again for every row the policy
-- checks, and each run is a lookup in profiles (both helpers are SECURITY
-- DEFINER, so Postgres can't fold them into the query). A read that checks a
-- few thousand rows did a few thousand identical lookups.
--
-- Wrapped in a sub-select,
--
--   using (grower_company_id = (select public.current_company_id()))
--
-- Postgres runs it once per query and reuses the answer. It is Supabase's own
-- documented fix ("call functions with select",
-- supabase.com/docs/guides/database/postgres/row-level-security), and the form
-- every policy here already uses for auth.uid().
--
-- Why the answer can't change: both helpers take no arguments and are STABLE,
-- and Postgres hands a STABLE function the snapshot of the query that calls it —
-- so once per query and once per row read the same profile and return the same
-- value for every row. Each policy keeps its name, command, roles
-- (authenticated) and permissive mode; ALTER POLICY only restates the
-- expression.
--
-- Left as they are: storage.objects and realtime.messages. They belong to
-- Supabase, and each has one policy that only ever checks a handful of rows.
--
-- Safe to run more than once. It changes nothing at all if any of the 41
-- policies isn't what the migrations in this folder left it as — see the check
-- below.

-- ---------------------------------------------------------------------------
-- 0. Check before changing: every policy is the one these migrations wrote
-- ---------------------------------------------------------------------------
--
-- A policy someone edited by hand on the live database would otherwise be
-- silently replaced by the rule below. Each policy must still read as created
-- (or already as this migration leaves it, so a second run passes); one that
-- doesn't stops the whole migration before anything changes. The expected text
-- is Postgres's own rendering of each rule, captured from a database built from
-- every migration here (identical on Postgres 17 and 18); "public" is put on the
-- search path while comparing so the rendering can't depend on the session's.
do $$
declare
  v_search_path text := pg_catalog.current_setting('search_path');
  v_mismatch text;
begin
  perform pg_catalog.set_config('search_path', 'public', true);

  select pg_catalog.string_agg(e.policyname || ' on ' || e.tablename, ', ' order by e.tablename, e.policyname)
  into v_mismatch
  from (values
    ('trading_days', 'trading_days_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('daily_shops', 'daily_shops_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('daily_arrangements', 'daily_arrangements_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('daily_arrangements', 'daily_arrangements_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('daily_picks', 'daily_picks_select_own',
     '(grower_company_id = current_company_id())',
     null),
    ('daily_picks', 'daily_picks_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('daily_picks', 'daily_picks_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('daily_pick_products', 'daily_pick_products_select_own',
     '(EXISTS ( SELECT 1 FROM daily_picks dp WHERE ((dp.id = daily_pick_products.daily_pick_id) AND (dp.grower_company_id = current_company_id()))))',
     null),
    ('daily_pick_products', 'daily_pick_products_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('daily_pick_products', 'daily_pick_products_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('daily_orders', 'daily_orders_select_own',
     '(customer_company_id = current_company_id())',
     null),
    ('daily_orders', 'daily_orders_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('daily_orders', 'daily_orders_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('daily_order_products', 'daily_order_products_select_own',
     '(EXISTS ( SELECT 1 FROM daily_orders do2 WHERE ((do2.id = daily_order_products.daily_order_id) AND (do2.customer_company_id = current_company_id()))))',
     null),
    ('daily_order_products', 'daily_order_products_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('daily_order_products', 'daily_order_products_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('order_submission_logs', 'order_submission_logs_select_own',
     '(EXISTS ( SELECT 1 FROM daily_orders do2 WHERE ((do2.id = order_submission_logs.daily_order_id) AND (do2.customer_company_id = current_company_id()))))',
     null),
    ('order_submission_logs', 'order_submission_logs_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('arrangement_records', 'arrangement_records_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('arrangement_records', 'arrangement_records_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('lifecycle_sessions', 'lifecycle_sessions_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('lifecycle_sessions', 'lifecycle_sessions_insert_backoffice',
     null,
     '("current_role"() = ''backoffice''::user_role)'),
    ('companies', 'companies_select_own',
     '(id = current_company_id())',
     null),
    ('companies', 'companies_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('profiles', 'profiles_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('profiles', 'profiles_update_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('profile_blocked_products', 'profile_blocked_products_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('product_families', 'product_families_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('product_varieties', 'product_varieties_select_backoffice_and_growers',
     '("current_role"() = ANY (ARRAY[''backoffice''::user_role, ''grower''::user_role]))',
     null),
    ('product_varieties', 'product_varieties_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('grower_products', 'grower_products_select_own',
     '(company_id = current_company_id())',
     null),
    ('grower_products', 'grower_products_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('grower_products', 'grower_products_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('product_customer_caps', 'product_customer_caps_select_own',
     '(customer_company_id = current_company_id())',
     null),
    ('product_customer_caps', 'product_customer_caps_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('product_customer_caps', 'product_customer_caps_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('alert_types', 'alert_types_write_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('notification_settings', 'notification_settings_select_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     null),
    ('notification_settings', 'notification_settings_update_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('notification_templates', 'notification_templates_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)'),
    ('notification_outbox', 'notification_outbox_backoffice',
     '("current_role"() = ''backoffice''::user_role)',
     '("current_role"() = ''backoffice''::user_role)')
  ) as e(tablename, policyname, qual, with_check)
  left join pg_catalog.pg_policies p
    on p.schemaname = 'public' and p.tablename = e.tablename and p.policyname = e.policyname
  where p.policyname is null
     -- Already wrapped by an earlier run of this migration reads as the
     -- original once the wrapper is taken off again.
     or pg_catalog.regexp_replace(pg_catalog.regexp_replace(p.qual,
          '\( SELECT ("current_role"|current_company_id)\(\) AS "?(current_role|current_company_id)"?\)', '\1()', 'g'),
          '\s+', ' ', 'g') is distinct from e.qual
     or pg_catalog.regexp_replace(pg_catalog.regexp_replace(p.with_check,
          '\( SELECT ("current_role"|current_company_id)\(\) AS "?(current_role|current_company_id)"?\)', '\1()', 'g'),
          '\s+', ' ', 'g') is distinct from e.with_check;

  perform pg_catalog.set_config('search_path', v_search_path, true);

  if v_mismatch is not null then
    raise exception 'migration 0066 changed nothing: these policies are not what the migrations left them as: %', v_mismatch
      using hint = 'Someone edited them on this database by hand, or an earlier migration was never applied. Compare pg_policies with packages/db/migrations before going on.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- trading_days
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to start, change, close and delete trading days.
-- PROTECTS AGAINST a grower or customer doing any of that by calling the API
-- directly — any signed-in account can, not only through the screens. Everyone
-- keeps reading trading_days through trading_days_select_authenticated
-- (unchanged).
alter policy "trading_days_write_backoffice" on public.trading_days
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- daily_shops
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to open and close the day's shop and choose
-- whether customers see prices. PROTECTS AGAINST a customer or grower opening
-- or closing the shop, or switching price visibility on for themselves.
alter policy "daily_shops_write_backoffice" on public.daily_shops
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- daily_arrangements
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to read the day's arrangement. PROTECTS AGAINST
-- growers and customers reading it — no other policy gives them this table.
alter policy "daily_arrangements_select_backoffice" on public.daily_arrangements
  using ((select public.current_role()) = 'backoffice');

-- SECURITY: ALLOWS backoffice to open, change and close the day's arrangement.
-- PROTECTS AGAINST anyone else doing so through the API.
alter policy "daily_arrangements_write_backoffice" on public.daily_arrangements
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- daily_picks
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS a grower to read their own company's picks. PROTECTS AGAINST
-- a grower reading another grower's picks.
alter policy "daily_picks_select_own" on public.daily_picks
  using (grower_company_id = (select public.current_company_id()));

-- SECURITY: ALLOWS backoffice to read every grower's picks. Growers stay
-- limited to their own (daily_picks_select_own); customers get none.
alter policy "daily_picks_select_backoffice" on public.daily_picks
  using ((select public.current_role()) = 'backoffice');

-- SECURITY: ALLOWS backoffice to write picks directly. PROTECTS AGAINST growers
-- writing their pick rows directly: a grower's own changes go only through
-- save_pick_lines / submit_pick (security definer), which enforce the
-- forward-only status rules a policy can't express (0010, 0011).
alter policy "daily_picks_write_backoffice" on public.daily_picks
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- daily_pick_products
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS a grower to read the lines of their own company's picks.
-- PROTECTS AGAINST a grower reading another grower's quantities and comments.
alter policy "daily_pick_products_select_own" on public.daily_pick_products
  using (exists (
      select 1 from public.daily_picks dp
      where dp.id = daily_pick_products.daily_pick_id
        and dp.grower_company_id = (select public.current_company_id())
    ));

-- SECURITY: ALLOWS backoffice to read every pick line (the arrangement boards,
-- the "on behalf of a grower" screen).
alter policy "daily_pick_products_select_backoffice" on public.daily_pick_products
  using ((select public.current_role()) = 'backoffice');

-- SECURITY: ALLOWS backoffice to write pick lines directly. PROTECTS AGAINST
-- growers writing lines directly and skipping save_pick_lines' checks — e.g.
-- never going below what has already been arranged.
alter policy "daily_pick_products_write_backoffice" on public.daily_pick_products
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- daily_orders
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS a customer to read their own company's orders. PROTECTS
-- AGAINST one customer reading another customer's orders.
alter policy "daily_orders_select_own" on public.daily_orders
  using (customer_company_id = (select public.current_company_id()));

-- SECURITY: ALLOWS backoffice to read every customer's orders.
alter policy "daily_orders_select_backoffice" on public.daily_orders
  using ((select public.current_role()) = 'backoffice');

-- SECURITY: ALLOWS backoffice to write orders directly. PROTECTS AGAINST
-- customers writing order rows directly: their orders go only through
-- submit_order (security definer), which checks the day isn't closed, each
-- product is in today's shop, and the pallet limits.
alter policy "daily_orders_write_backoffice" on public.daily_orders
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- daily_order_products
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS a customer to read the lines of their own company's orders.
-- PROTECTS AGAINST one customer reading another customer's order lines.
alter policy "daily_order_products_select_own" on public.daily_order_products
  using (exists (
      select 1 from public.daily_orders do2
      where do2.id = daily_order_products.daily_order_id
        and do2.customer_company_id = (select public.current_company_id())
    ));

-- SECURITY: ALLOWS backoffice to read every order line.
alter policy "daily_order_products_select_backoffice" on public.daily_order_products
  using ((select public.current_role()) = 'backoffice');

-- SECURITY: ALLOWS backoffice to write order lines directly (editing on a
-- customer's behalf). PROTECTS AGAINST customers writing lines directly and
-- skipping submit_order's checks — today's shop, pallet limits.
alter policy "daily_order_products_write_backoffice" on public.daily_order_products
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- order_submission_logs
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS a customer to read the submission log of their own company's
-- orders. PROTECTS AGAINST reading another customer's. (Append-only: no policy
-- lets anyone update or delete a log row.)
alter policy "order_submission_logs_select_own" on public.order_submission_logs
  using (exists (
      select 1 from public.daily_orders do2
      where do2.id = order_submission_logs.daily_order_id
        and do2.customer_company_id = (select public.current_company_id())
    ));

-- SECURITY: ALLOWS backoffice to read every order's submission log (the
-- arrangement board shows it).
alter policy "order_submission_logs_select_backoffice" on public.order_submission_logs
  using ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- arrangement_records
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to read every arrangement record — whose pallets
-- go to which customer, at what price. PROTECTS AGAINST growers and customers
-- reading the day's allocations and other companies' prices.
alter policy "arrangement_records_select_backoffice" on public.arrangement_records
  using ((select public.current_role()) = 'backoffice');

-- SECURITY: ALLOWS backoffice to allocate pallets and set prices
-- (create_arrangement_record and close_arrangement run as the caller, so they
-- rely on this). PROTECTS AGAINST anyone else changing allocations or prices.
alter policy "arrangement_records_write_backoffice" on public.arrangement_records
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- lifecycle_sessions
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to read the log of who started, opened and closed
-- each day. PROTECTS AGAINST others reading it.
alter policy "lifecycle_sessions_select_backoffice" on public.lifecycle_sessions
  using ((select public.current_role()) = 'backoffice');

-- SECURITY: ALLOWS backoffice to add an entry to that log. PROTECTS AGAINST
-- anyone else writing entries. (Append-only: no update or delete policy exists
-- for any role.)
alter policy "lifecycle_sessions_insert_backoffice" on public.lifecycle_sessions
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS every signed-in user to read their own company's row.
-- PROTECTS AGAINST reading other companies' records — contacts, WhatsApp groups
-- — a leak across companies.
alter policy "companies_select_own" on public.companies
  using (id = (select public.current_company_id()));

-- SECURITY: ALLOWS backoffice to read, create, edit and delete every company
-- (FOR ALL, so this is also how backoffice reads them all). PROTECTS AGAINST
-- growers and customers editing any company, their own included.
alter policy "companies_write_backoffice" on public.companies
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to read every user's profile (the Users screen).
-- Everyone else reads only their own (profiles_select_own, unchanged).
alter policy "profiles_select_backoffice" on public.profiles
  using ((select public.current_role()) = 'backoffice');

-- SECURITY: ALLOWS backoffice to edit any user's profile — role, company,
-- display name. PROTECTS AGAINST other users editing anyone's profile but their
-- own (profiles_update_own, unchanged — and 0055's trigger stops them changing
-- their own role or company).
alter policy "profiles_update_backoffice" on public.profiles
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- profile_blocked_products
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to read and set which products each user may not
-- order. PROTECTS AGAINST a user unblocking products for themselves.
alter policy "profile_blocked_products_write_backoffice" on public.profile_blocked_products
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- product_families
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to create, edit and delete product families.
-- PROTECTS AGAINST anyone else changing the catalog. Everyone keeps reading
-- families through product_families_select_authenticated (unchanged).
alter policy "product_families_write_backoffice" on public.product_families
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- product_varieties
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice and growers to read the catalog's varieties
-- (growers need their pick lines' names). PROTECTS AGAINST customers — and
-- accounts with no profile, for which current_role() is null — reading
-- varieties directly, and with them the prices the catalog functions hide from
-- customers (0056).
alter policy "product_varieties_select_backoffice_and_growers" on public.product_varieties
  using ((select public.current_role()) in ('backoffice', 'grower'));

-- SECURITY: ALLOWS backoffice to create, edit and delete varieties and their
-- prices. PROTECTS AGAINST anyone else changing products or prices.
alter policy "product_varieties_write_backoffice" on public.product_varieties
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- grower_products
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS a grower to read their own in-season product list. PROTECTS
-- AGAINST reading another grower's.
alter policy "grower_products_select_own" on public.grower_products
  using (company_id = (select public.current_company_id()));

-- SECURITY: ALLOWS backoffice to read every grower's in-season list.
alter policy "grower_products_select_backoffice" on public.grower_products
  using ((select public.current_role()) = 'backoffice');

-- SECURITY: ALLOWS backoffice to set growers' in-season lists. PROTECTS AGAINST
-- a grower changing their own list directly.
alter policy "grower_products_write_backoffice" on public.grower_products
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- product_customer_caps
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS a customer to read their own per-product pallet caps.
-- PROTECTS AGAINST reading another customer's caps.
alter policy "product_customer_caps_select_own" on public.product_customer_caps
  using (customer_company_id = (select public.current_company_id()));

-- SECURITY: ALLOWS backoffice to read every customer's caps.
alter policy "product_customer_caps_select_backoffice" on public.product_customer_caps
  using ((select public.current_role()) = 'backoffice');

-- SECURITY: ALLOWS backoffice to set caps. PROTECTS AGAINST a customer raising
-- their own.
alter policy "product_customer_caps_write_backoffice" on public.product_customer_caps
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- alert_types
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to edit the alert types — each alert's text and
-- the screen it opens. PROTECTS AGAINST others rewriting what everyone's alerts
-- say or where they lead. Everyone keeps reading them through
-- alert_types_select_authenticated (unchanged).
alter policy "alert_types_write_backoffice" on public.alert_types
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- notification_settings
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to read the WhatsApp switches.
alter policy "notification_settings_select_backoffice" on public.notification_settings
  using ((select public.current_role()) = 'backoffice');

-- SECURITY: ALLOWS backoffice to flip them. PROTECTS AGAINST anyone else
-- turning WhatsApp messages on or off.
alter policy "notification_settings_update_backoffice" on public.notification_settings
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- notification_templates
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to read and edit the WhatsApp message templates.
-- PROTECTS AGAINST others changing what the messages say.
alter policy "notification_templates_backoffice" on public.notification_templates
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');

-- ---------------------------------------------------------------------------
-- notification_outbox
-- ---------------------------------------------------------------------------

-- SECURITY: ALLOWS backoffice to read and manage the queue of WhatsApp
-- messages. PROTECTS AGAINST others reading message contents and recipients, or
-- queueing messages. (The dispatcher uses the service-role key, which bypasses
-- RLS.)
alter policy "notification_outbox_backoffice" on public.notification_outbox
  using ((select public.current_role()) = 'backoffice')
  with check ((select public.current_role()) = 'backoffice');
