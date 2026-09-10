-- Optional (not required for functional parity), same trigger-only pattern
-- as 0019_customer-catalog-realtime.sql: adds the tables behind the
-- trading-day lifecycle, the arrangement board, and alerts to the realtime
-- publication so their screens can replace up-to-60s polling / on-demand
-- refetch with a push-triggered invalidateQueries — never a read of the
-- broadcast row payload itself, so this stays inside the same RLS/tenant
-- privacy boundary as the existing subscription.
alter publication supabase_realtime add table public.trading_days;
alter publication supabase_realtime add table public.daily_arrangements;
alter publication supabase_realtime add table public.daily_picks;
alter publication supabase_realtime add table public.daily_orders;
alter publication supabase_realtime add table public.arrangement_records;
alter publication supabase_realtime add table public.alerts;
