-- One-off data cleanup. NOT a migration: it changes rows, not schema, and is
-- not in meta/_journal.json — run it by hand once and keep it for the record.
-- Do NOT run it while a test suite is in flight; it deletes exactly the kind of
-- row a running test is using.
--
-- WHY. The domain (vitest) and e2e (Playwright) suites run against this hosted
-- project — there is no local Docker instance — and they create real rows.
-- Most tests clean up after themselves; a few do not, and their leftovers are
-- now visible to a human using the app. Two "Happy-path grower <uuid>"
-- companies show up on the arrangement board for the live 2026-09-08 day,
-- sitting alongside the ten real demo growers.
--
-- HOW A FIXTURE IS IDENTIFIED. Every suite names its rows with a trailing
-- randomUUID() so parallel runs cannot collide — see
-- packages/domain/src/auth/test-helpers.ts ("Test Company"),
-- .../reference-data/test-helpers.ts ("Test Family" / "Test Variety"),
-- .../reference-data/rpc.test.ts ("Happy-path grower"), and the e2e specs'
-- "E2E Variety". No seeded demo row does that: the demo set is
-- "Grower 01".."Grower 10", "Customer 01".."Customer 10", "Distributor" and
-- "הובלות טסט". So "the name embeds a UUID" is a precise, self-maintaining
-- signature — it also catches any fixture leaked after this file was written,
-- which hardcoded ids would not.
--
-- WHAT IT REMOVES (surveyed 2026-09-10, before any deletion):
--     2  auth.users            test-<uuid>@example.test
--     2  profiles              "Test User" (cascade-deleted with the auth user)
--     4  companies             2x "Test Company <uuid>", 2x "Happy-path grower <uuid>"
--     2  daily_picks           both on the live 2026-09-08 day, 0 pallets
--     2  daily_pick_products   both pointing at leaked varieties
--     2  grower_products       leaked grower <-> leaked variety
--    10  notification_outbox   all already dispatched, all to leaked companies
--     5  product_varieties     4x "Test Variety <uuid>", 1x "E2E Variety <uuid>"
--     5  product_families      "Test Family <uuid>", one per leaked variety
--
-- WHY DELETE RATHER THAN DEACTIVATE. companies.status exists, and setting it to
-- inactive would hide these from most screens. But these rows are not retired
-- business entities whose history is worth keeping — they are debris from a
-- test process, and they carry no real arrangement, order, or delivery. There
-- is nothing to audit. (Contrast clear-stale-outbox-backlog.sql in this same
-- directory, which deliberately preserves rather than deletes, because those
-- rows *were* the audit trail of real close_arrangement runs.)
--
-- The whole thing is one transaction: either the fixture set goes entirely or
-- nothing does. Every guard below raises, which rolls the transaction back.

begin;

-- The fixture set, resolved once and held for the duration. Temp tables rather
-- than a repeated regex, so that every guard and every delete below is provably
-- talking about the same set of rows.
create temporary table _fixture_companies on commit drop as
  select id from public.companies
  where name ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

create temporary table _fixture_varieties on commit drop as
  select id from public.product_varieties
  where name ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

create temporary table _fixture_families on commit drop as
  select id from public.product_families
  where name ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

create temporary table _fixture_users on commit drop as
  select id from auth.users
  where email ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

-- GUARD — nothing seeded may be entangled with the fixture set.
--
-- This is the guard that makes deleting safe rather than merely convenient.
-- The survey found the fixture set fully self-contained: leaked growers hold
-- only leaked varieties, leaked varieties belong only to leaked families, and
-- no order, cap, blocked-product or arrangement record touches any of it. If
-- that has stopped being true — because a real order was placed against a
-- leftover test product, say, or a demo grower was given one — then deleting
-- would either fail on a foreign key or destroy something real. Either way the
-- premise of this script is gone and a human has to look before it runs.
do $guard$
declare
  v_bad integer;
  v_detail text;
begin
  -- A seeded grower stocking a leaked variety, or a leaked grower stocking a
  -- seeded variety: the two catalogs have crossed.
  select count(*) into v_bad
  from public.grower_products g
  where (g.product_variety_id in (select id from _fixture_varieties))
     is distinct from (g.company_id in (select id from _fixture_companies));
  if v_bad > 0 then
    raise exception 'ABORTED: % grower_products row(s) mix a fixture with a seeded row.', v_bad;
  end if;

  -- A pick line on a fixture grower that points at a real product, or a real
  -- grower's pick line pointing at a fixture product.
  select count(*) into v_bad
  from public.daily_pick_products dpp
  join public.daily_picks dp on dp.id = dpp.daily_pick_id
  where (dpp.product_variety_id in (select id from _fixture_varieties))
     is distinct from (dp.grower_company_id in (select id from _fixture_companies));
  if v_bad > 0 then
    raise exception 'ABORTED: % daily_pick_products row(s) mix a fixture with a seeded row.', v_bad;
  end if;

  -- Anything arranged, ordered, capped or blocked against the fixture set.
  -- These were all zero at survey time; a non-zero count means a fixture has
  -- been used in real work and is no longer safe to delete silently.
  select
    (select count(*) from public.arrangement_records ar
       where ar.customer_company_id in (select id from _fixture_companies)
          or ar.daily_pick_product_id in (
               select dpp.id from public.daily_pick_products dpp
               join public.daily_picks dp on dp.id = dpp.daily_pick_id
               where dp.grower_company_id in (select id from _fixture_companies)))
  + (select count(*) from public.daily_orders o
       where o.customer_company_id in (select id from _fixture_companies))
  + (select count(*) from public.daily_order_products op
       where op.product_variety_id in (select id from _fixture_varieties))
  + (select count(*) from public.product_customer_caps pc
       where pc.product_variety_id in (select id from _fixture_varieties)
          or pc.customer_company_id in (select id from _fixture_companies))
  + (select count(*) from public.profile_blocked_products pb
       where pb.product_variety_id in (select id from _fixture_varieties))
  into v_bad;
  if v_bad > 0 then
    raise exception 'ABORTED: % arrangement/order/cap/block row(s) reference the fixture set.', v_bad;
  end if;

  -- A leaked family must not still hold a real variety, or deleting the family
  -- would take a real product with it.
  select count(*) into v_bad
  from public.product_varieties pv
  where pv.family_id in (select id from _fixture_families)
    and pv.id not in (select id from _fixture_varieties);
  if v_bad > 0 then
    raise exception 'ABORTED: % seeded variety(ies) live inside a fixture family.', v_bad;
  end if;

  -- A grower assigned a fixture company as its transporter would be left
  -- pointing at nothing. That FK defaults to RESTRICT so this would fail
  -- anyway — better to say why than to surface a raw constraint violation.
  select count(*) into v_bad
  from public.companies c
  where c.transporter_company_id in (select id from _fixture_companies)
    and c.id not in (select id from _fixture_companies);
  if v_bad > 0 then
    raise exception 'ABORTED: % company(ies) use a fixture company as their transporter.', v_bad;
  end if;

  -- Every profile on a fixture company must be deletable via its auth user.
  -- profiles.company_id is ON DELETE NO ACTION, so a profile whose auth user is
  -- NOT in the fixture set would block the company delete — and would mean a
  -- real person had been attached to a test company.
  select count(*) into v_bad
  from public.profiles p
  where p.company_id in (select id from _fixture_companies)
    and p.user_id not in (select id from _fixture_users);
  if v_bad > 0 then
    raise exception 'ABORTED: % profile(s) on a fixture company belong to a non-fixture user.', v_bad;
  end if;

  -- Lifecycle Invariant 1 should already hold: at most one non-closed trading
  -- day. If it does not, a parked day was never restored
  -- (packages/domain/src/lifecycle-engine/trading-day-slot.ts) — a different
  -- problem, and one this cleanup must not run on top of.
  select count(*) into v_bad from public.trading_days where phase <> 'closed';
  if v_bad > 1 then
    raise exception 'ABORTED: % non-closed trading days — the single-open-day invariant is already violated.', v_bad;
  end if;

  select string_agg(name, ', ') into v_detail
  from public.companies where id in (select id from _fixture_companies);
  raise notice 'Guards passed. Removing fixture companies: %', coalesce(v_detail, '(none)');
end
$guard$;

-- Deletes, in foreign-key order. Several of these FKs are ON DELETE CASCADE and
-- would go on their own, but each is spelled out so the row counts below can be
-- checked one by one — a silent cascade is exactly what you do not want to rely
-- on when deleting from a live database.

-- 1. Outbox first: recipient_company_id is ON DELETE NO ACTION, so these block
--    the company delete. All ten are already dispatched (sent_at is set), so
--    nothing pending is being discarded.
delete from public.notification_outbox
where recipient_company_id in (select id from _fixture_companies);

-- 2. Alerts are keyed to a user id with no foreign key behind it, so they would
--    not block anything — they would simply be left pointing at a user that no
--    longer exists. Zero rows at survey time; kept for completeness.
delete from public.alerts
where intended_for_user_id in (select id from _fixture_users);

-- 3. Pick lines before picks (FK), and before varieties (also NO ACTION).
delete from public.daily_pick_products
where daily_pick_id in (
  select id from public.daily_picks
  where grower_company_id in (select id from _fixture_companies)
);

delete from public.daily_picks
where grower_company_id in (select id from _fixture_companies);

-- 4. The grower's in-season catalog. CASCADE from both sides; explicit anyway.
delete from public.grower_products
where company_id in (select id from _fixture_companies)
   or product_variety_id in (select id from _fixture_varieties);

-- 5. The auth users. profiles.user_id is ON DELETE CASCADE, so this removes the
--    two "Test User" profiles too — which is what unblocks the companies, since
--    profiles.company_id is NO ACTION. auth.identities and auth.sessions
--    cascade the same way.
delete from auth.users where id in (select id from _fixture_users);

-- 6. The companies themselves.
delete from public.companies where id in (select id from _fixture_companies);

-- 7. Products last: varieties reference families with NO ACTION.
delete from public.product_varieties where id in (select id from _fixture_varieties);
delete from public.product_families where id in (select id from _fixture_families);

commit;

-- Expected row counts, in order:
--   DELETE 10   (notification_outbox)
--   DELETE 0    (alerts)
--   DELETE 2    (daily_pick_products)
--   DELETE 2    (daily_picks)
--   DELETE 2    (grower_products)
--   DELETE 2    (auth.users, cascading 2 profiles)
--   DELETE 4    (companies)
--   DELETE 5    (product_varieties)
--   DELETE 5    (product_families)
--
-- Afterwards all four of these should return 0:
--   select count(*) from public.companies         where name  ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
--   select count(*) from public.product_families  where name  ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
--   select count(*) from public.product_varieties where name  ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
--   select count(*) from auth.users               where email ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
--
-- And the seeded demo set should be untouched: 10 growers, 10 customers,
-- 1 distributor, 1 transporter, 21 auth users, and the live 2026-09-08 day
-- still in phase 'shop_open'.
