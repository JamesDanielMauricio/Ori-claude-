-- Closes two holes found in the 2026-09-25 code audit. Both were confirmed
-- against the hosted project's own catalog (column privileges, policies,
-- function ACLs — read-only queries) before this was written, and both are
-- reachable by any account that can sign in, including one a stranger
-- registers for themselves while public sign-up is enabled.

-- ---------------------------------------------------------------------------
-- 1. profiles: role, company_id and user_id can only be changed by backoffice
-- ---------------------------------------------------------------------------
--
-- 0003 granted `update` on the whole profiles table to `authenticated` and
-- let every user update their own row ("profiles_update_own"), so a user can
-- clear their own must_change_password (change-password.tsx) and edit their
-- own display name and phone (profile.tsx). But RLS decides which ROWS a
-- user may touch, never which COLUMNS — so the same policy also let any
-- customer or grower run
--
--   update profiles set role = 'backoffice' where user_id = auth.uid()
--
-- and become backoffice: every backoffice-only policy, every backoffice RPC,
-- and apps/api's service-role procedures (which read the role from this
-- table) would then treat them as staff. Rewriting company_id the same way
-- would put them inside another company's orders and picks.
--
-- A column-level grant can't close this on its own: save_user (0007) is
-- security invoker, so when backoffice changes someone's role on the Users
-- screen it also runs as `authenticated`, and would lose the one column it
-- exists to change. A trigger can tell the two apart, because it can ask
-- whose profile is making the change.
--
-- SECURITY: this trigger ALLOWS a change to role, company_id or user_id only
-- when (a) the caller's own profile is backoffice — the Users screen's
-- save_user, which already requires the same thing — or (b) the statement is
-- not running as one of the API's end-user roles at all: the service-role key
-- (Edge Functions, apps/api's Admin API calls), the database owner (apps/api's
-- Drizzle connection used by adminResetPassword and bulkCreateUsers,
-- migrations, the Bubble import), or a security definer function. It
-- PROTECTS AGAINST a customer or grower rewriting their own row to gain
-- backoffice rights or another company's data. Every other column —
-- must_change_password, display_name, phone_number — stays self-editable
-- exactly as before, so the change-password and profile screens are
-- unaffected.
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- `current_user` is the Postgres role the statement runs as: PostgREST
  -- switches to `authenticated` (or `anon`) for every browser request, while
  -- the service role, the owner and security definer functions run as
  -- something else and are trusted to have checked their own caller.
  -- public.current_role() — schema-qualified, with parentheses — is the
  -- caller's APP role from profiles (0003); the bare CURRENT_ROLE keyword
  -- would be the Postgres role instead.
  if current_user in ('authenticated', 'anon')
     and (new.role is distinct from old.role
          or new.company_id is distinct from old.company_id
          or new.user_id is distinct from old.user_id)
     and public.current_role() is distinct from 'backoffice'
  then
    raise exception 'FORBIDDEN: only backoffice may change a profile''s role, company or user id'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_profile_privileged_columns() is
  'BEFORE UPDATE trigger on profiles (migration 0055). Rejects a change to role, company_id or user_id made through the API by anyone whose own profile is not backoffice, so profiles_update_own lets a user edit only their own must_change_password, display_name and phone_number. Service role, the database owner and security definer functions are not restricted.';

-- Dropped first so the file can be re-run safely from the SQL editor.
drop trigger if exists guard_profile_privileged_columns on public.profiles;

create trigger guard_profile_privileged_columns
  before update on public.profiles
  for each row
  execute function public.guard_profile_privileged_columns();

-- ---------------------------------------------------------------------------
-- 2. enqueue_backoffice_notification: callable only by the functions that use it
-- ---------------------------------------------------------------------------
--
-- SECURITY: enqueue_backoffice_notification (0031) is security definer — it
-- writes notification_outbox rows past that table's backoffice-only RLS —
-- and it takes the template key and the message payload straight from its
-- arguments. 0031 described it as "Internal only (no grant to
-- authenticated)", but Postgres grants EXECUTE on every new function to
-- PUBLIC, and Supabase's default privileges grant it to anon and
-- authenticated as well, so it was callable as a PostgREST RPC by any
-- signed-in user.
--
-- This revoke ALLOWS only its three real callers — save_pick_lines,
-- update_pick_product_pallets and submit_order. All three are security
-- definer functions owned by `postgres`, so they call it as `postgres`, whose
-- own explicit grant (postgres=X in the function's ACL) this statement does
-- not touch. It PROTECTS AGAINST a customer, a grower or a self-registered
-- account calling it directly to queue WhatsApp messages of their own wording
-- to the back office, as many times as they like, which whatsapp-dispatch
-- would then send from the business's own number.
revoke execute on function public.enqueue_backoffice_notification(uuid, text, jsonb)
  from public, anon, authenticated;
