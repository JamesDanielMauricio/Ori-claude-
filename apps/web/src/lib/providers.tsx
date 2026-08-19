"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ToastProvider } from "@/components/ui/toast";

import { trpc, trpcClientConfig } from "./trpc-client";

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
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }),
  );
  const [trpcClient] = useState(() => trpc.createClient(trpcClientConfig()));

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
