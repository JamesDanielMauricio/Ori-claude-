// Read directly rather than through @ori/shared/env's generic loader:
// Next.js only inlines `process.env.NEXT_PUBLIC_*` into the client bundle
// when it sees this exact static access pattern at build time — routing it
// through a dynamic `process.env` lookup would leave it undefined in the
// browser.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
