import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState, type ReactNode } from "react";

import { ToastProvider } from "@/components/ui/toast";
import { TRANSITION_ENTER } from "@/lib/motion";

import { trpc, trpcClientConfig } from "./trpc-client";

// Whether a failed READ is worth trying again. (Only reads: this is a
// `queries` default, and mutations already default to no retries.)
//
// React Query's factory default retries every failure three times with
// exponential backoff. That is right for a dropped connection and wrong for
// an answer: a request that reached Postgres and came back refused —  a
// malformed id, an RLS denial, one of our own P0xxx business errors — will
// be refused identically three more times. The user waits ~15s watching a
// loading skeleton for an error the server already had. Reaching a
// historical order by a hand-edited or stale URL is exactly that case.
//
// The test is whether the error carries a PostgREST `code`. Every
// PostgrestError does (the SQLSTATE, or PostgREST's own PGRSTxxx), and its
// presence means the round trip completed and the server rendered a verdict.
// A genuine transport failure — offline, DNS, TLS, a 5xx with no body —
// throws a bare TypeError/fetch error with no such code, and still gets the
// full three attempts, which is the case retries exist for.
function shouldRetryRead(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) return false;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return !(typeof code === "string" && code.length > 0);
}

export function Providers({ children }: { children: ReactNode }) {
  // React Query's factory default (staleTime: 0) means every query is
  // stale the instant it lands — re-mounting an already-fetched query
  // (e.g. re-selecting a previously-viewed order row) shows cached data
  // instantly but still fires a background refetch, which is exactly the
  // per-expand DB round-trip the source's own Performance Issues audit
  // (Issue 3/5) flagged and asked to be eliminated. `invalidateQueries`
  // (used throughout after every mutation) forces a refetch regardless of
  // staleTime, so this doesn't make any mutation's "show the fresh data"
  // behavior stale — it only stops an unmodified row from re-querying
  // itself on every re-visit within this window. See docs/ARCHITECTURE.md
  // § Performance verification for the measurement that caught this.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: shouldRetryRead } },
      }),
  );
  const [trpcClient] = useState(() => trpc.createClient(trpcClientConfig()));

  return (
    // App-wide defaults for every component animated with Motion, set once
    // here so no individual component has to remember them.
    //
    // reducedMotion="user": when the OS "reduce motion" setting is on, Motion
    // switches transform animations (movement, scaling) off while opacity
    // fades keep running — things still visibly appear and disappear, they
    // just stop moving. It is the JavaScript counterpart of the
    // prefers-reduced-motion block at the bottom of globals.css, which can
    // only reach CSS animations (and is stricter, dropping fades too, because
    // a CSS rule can't tell a fade from a slide).
    //
    // transition: the house ENTER timing from lib/motion.ts, for any component
    // that doesn't name its own. Something leaving should pass
    // TRANSITION_EXIT instead, so it eases in rather than out.
    <MotionConfig reducedMotion="user" transition={TRANSITION_ENTER}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </MotionConfig>
  );
}
