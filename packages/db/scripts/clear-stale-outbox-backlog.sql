-- One-off data cleanup. NOT a migration: it changes rows, not schema, and is
-- not in meta/_journal.json — run it by hand once and keep it for the record.
--
-- WHY. This project has 61 notification_outbox rows still pending, seeded on
-- 2026-08-19 (30) and 2026-09-07 (31) by sample data and demo close_arrangement
-- runs. They have never been dispatched, because notification_settings has had
-- whatsapp_enabled = false throughout.
--
-- WHY NOW, SPECIFICALLY. Right now not one of them can reach anybody: no
-- company has a whatsapp_group_id and no profile has a phone_number, so
-- resolve_outbox_dispatch returns zero targets for every single row (verified
-- — the join below returns 0). The moment someone fills in the first phone
-- number, that stops being true: the drain does not filter by age, so the next
-- run after WhatsApp is enabled would deliver a backlog of stale
-- "today's arrangement has closed" messages, some of them three weeks old, to
-- real growers and customers. Clearing them while they are provably
-- undeliverable costs nothing; clearing them later is a race against whoever
-- adds contact details first.
--
-- WHY sent_at RATHER THAN DELETE. sent_at means "this row is finished — every
-- target it resolved to has been delivered." With zero targets that is
-- vacuously true, and it is exactly what a drain pass would write for these
-- rows today (see the "resolved to no targets at all" branch in
-- packages/domain/src/notifications/drain.ts). So this is not inventing a
-- state: it is doing by hand what the drain would do, without needing to
-- switch WhatsApp on to get there. Deleting would instead discard the audit
-- trail of which close_arrangement runs produced which notifications.

begin;

-- Guard: refuse to run at all if any pending row could actually reach someone.
-- If contact details have been added since this file was written, the premise
-- above no longer holds and this cleanup must be re-thought, not force-run.
do $$
declare
  v_reachable integer;
begin
  select count(*) into v_reachable
  from public.notification_outbox o
  join public.companies c on c.id = o.recipient_company_id
  where o.sent_at is null
    and (
      (c.whatsapp_group_id is not null and c.whatsapp_group_id <> '')
      or exists (
        select 1 from public.profiles p
        where p.company_id = c.id
          and p.phone_number is not null
          and p.phone_number <> ''
      )
    );

  if v_reachable > 0 then
    raise exception
      'ABORTED: % pending outbox row(s) now resolve to a real recipient. Contact details were added after this script was written — review the backlog before clearing it.',
      v_reachable;
  end if;
end $$;

-- Bounded by date so this can only ever affect the known backlog, never a row
-- created by normal operation after today.
update public.notification_outbox
set sent_at = now(),
    last_attempted_at = now()
where sent_at is null
  and created_at < date '2026-09-08';

commit;

-- Expected: UPDATE 61, and afterwards
--   select count(*) from public.notification_outbox where sent_at is null;  -- 0
