-- Supabase Auth fully replaces the custom session/password-reset/
-- temporary-credential system these tables backed (JWT-based sessions,
-- built-in recovery-link flow, Admin API for admin-mediated resets and
-- bulk provisioning). Nothing references them anymore. See
-- docs/SCHEMA_DECISIONS.md.
DROP TABLE "auth_sessions";--> statement-breakpoint
DROP TABLE "password_reset_tokens";--> statement-breakpoint
DROP TABLE "temporary_credentials";
