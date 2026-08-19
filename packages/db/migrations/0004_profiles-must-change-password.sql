-- Forced password change on first login, checked on sign-in before
-- anything else loads. Cleared by the user's own client the moment they
-- successfully set a real password (see the "profiles_update_own" RLS
-- policy from 0003, which already permits this self-write).
ALTER TABLE "profiles" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;
