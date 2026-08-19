-- Supabase Auth adoption: identity moves to auth.users (Supabase-managed).
-- public.users is retired; public.profiles becomes the "ours" extension of
-- a Supabase Auth identity. See docs/SCHEMA_DECISIONS.md.

-- 1. Drop the FKs that pointed at the old public.users table so it can be
--    dropped, and so the enum it used can be redefined.
ALTER TABLE "auth_sessions" DROP CONSTRAINT "auth_sessions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "temporary_credentials" DROP CONSTRAINT "temporary_credentials_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "temporary_credentials" DROP CONSTRAINT "temporary_credentials_issued_by_user_id_users_id_fk";--> statement-breakpoint

-- 2. Drop the old identity table. Its reason for existing (email,
--    password hash, credential lifecycle) is now Supabase Auth's job.
DROP TABLE "users";--> statement-breakpoint

-- 3. Redefine user_role without "transporter" — a transporter never signs
--    in, so it never gets a Supabase Auth account or a profiles row.
DROP TYPE "public"."user_role";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('backoffice', 'grower', 'customer');--> statement-breakpoint

-- 4. profiles: the "ours" extension of an auth.users identity.
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 5. Minimal product-catalog placeholder + the per-user blacklist join
--    table (a real many-to-many relationship, not a list-of-references
--    field on the identity row — see product-variety.ts / profile-blocked-product.ts).
CREATE TABLE "product_varieties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_blocked_products" (
	"user_id" uuid NOT NULL,
	"product_variety_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_blocked_products_user_id_product_variety_id_pk" PRIMARY KEY("user_id","product_variety_id")
);
--> statement-breakpoint
ALTER TABLE "profile_blocked_products" ADD CONSTRAINT "profile_blocked_products_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_blocked_products" ADD CONSTRAINT "profile_blocked_products_product_variety_id_product_varieties_id_fk" FOREIGN KEY ("product_variety_id") REFERENCES "product_varieties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 6. Repoint the auth-support tables at profiles.user_id instead of the
--    now-dropped users.id. Cascade on delete: removing a profile (which
--    cascades from removing the underlying auth.users row) should clean up
--    its sessions/tokens/credentials rather than leave them orphaned.
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_credentials" ADD CONSTRAINT "temporary_credentials_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_credentials" ADD CONSTRAINT "temporary_credentials_issued_by_user_id_profiles_user_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "profiles"("user_id") ON DELETE no action ON UPDATE no action;
