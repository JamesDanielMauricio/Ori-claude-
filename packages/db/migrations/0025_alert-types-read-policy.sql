-- alert_types' original RLS (0023) was backoffice-only for every
-- operation, including SELECT — a real bug, not a stricter-than-needed
-- default: a user's own Alerts row references alert_type_id, and the
-- client renders an alert's text/deep-link by reading that joined row
-- under the RECIPIENT's own session, not backoffice's. With no SELECT
-- policy for non-backoffice roles, that embedded join silently resolved
-- to null for every non-backoffice user — an alert existed (alerts' own
-- RLS already lets them see it) but rendered as empty text, no
-- navigation target. alert_types holds no tenant-sensitive data (just
-- admin-authored template copy and a route string), so this is the same
-- shape as product_families: any authenticated user reads, only
-- backoffice writes.
drop policy "alert_types_backoffice" on public.alert_types;

create policy "alert_types_select_authenticated" on public.alert_types
  for select
  to authenticated
  using (true);

create policy "alert_types_write_backoffice" on public.alert_types
  for all
  to authenticated
  using (public.current_role() = 'backoffice')
  with check (public.current_role() = 'backoffice');
