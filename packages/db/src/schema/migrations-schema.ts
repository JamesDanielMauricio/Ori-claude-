// The entry point drizzle-kit reads to generate/diff migrations from.
// Deliberately excludes `auth-users.ts` (the shadow reference to
// Supabase's own `auth.users`) so drizzle-kit never tries to manage that
// table's DDL — Supabase owns it. `profiles.ts` still imports `authUsers`
// directly for its foreign key, which is enough for drizzle-kit to emit
// the correct `REFERENCES "auth"."users"` constraint without this barrel
// re-exporting it. See docs/SCHEMA_DECISIONS.md and drizzle.config.ts.
export * from "./enums";
export * from "./company";
export * from "./profile";
export * from "./product-family";
export * from "./product-variety";
export * from "./profile-blocked-product";
export * from "./grower-product";
export * from "./product-customer-cap";
export * from "./trading-day";
export * from "./daily-shop";
export * from "./daily-arrangement";
export * from "./daily-pick";
export * from "./daily-pick-product";
export * from "./daily-order";
export * from "./arrangement-record";
export * from "./lifecycle-session";
