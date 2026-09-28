// PostgREST rejects a token whose "issued at" time is later than its own clock
// with 401 PGRST303, "JWT issued at future". On the hosted project the sign-in
// server's clock and a database server's can be a second or so apart, so the
// first read made with a brand-new token can be refused even though the token
// is perfectly valid. Seen 2026-09-29 in the e2e alerts spec: two identical
// profile reads sent at the same moment right after sign-in — one was refused
// with PGRST303, the other answered normally.
//
// It only affects a token in its first moments, so waiting and asking again
// is the whole fix. Safe to repeat: the token is checked before PostgREST runs
// any SQL, so a refused attempt did nothing.
//
// Retries ONLY that code. Every other outcome — success, a missing row
// (PGRST116), a real authorization failure, a dropped connection — goes back
// to the caller unchanged on the first attempt, so callers keep their own
// error handling exactly as it was.
export const CLOCK_SKEW_CODE = "PGRST303";

// Three attempts a second apart: covers a skew of about two seconds, and
// costs a failing caller at most two seconds before it sees the error.
const ATTEMPTS = 3;
const WAIT_MS = 1000;

// `run` must build a NEW query each call — a Supabase query is sent when it is
// awaited, so pass `() => supabase.from(...)...`, not an already-built query.
export async function retryOnClockSkew<T extends { error: { code?: string } | null }>(
  run: () => PromiseLike<T>,
): Promise<T> {
  for (let attempt = 1; attempt < ATTEMPTS; attempt++) {
    const result = await run();
    if (result.error?.code !== CLOCK_SKEW_CODE) return result;
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  }
  return run();
}
