// Vite replaces `import.meta.env.VITE_*` with the literal value at build
// time, and only for names carrying the VITE_ prefix — that prefix is the
// opt-in that marks a variable as safe to ship in the browser bundle, so
// nothing without it can leak into client code by accident.
//
// Read via static property access, not a dynamic lookup, for the same
// reason the Next.js version did: the replacement is textual, so
// `import.meta.env[someName]` would not be substituted and would arrive
// undefined in the browser.
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
