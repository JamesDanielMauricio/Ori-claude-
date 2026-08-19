import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TS source, not precompiled JS — Next only
  // transpiles node_modules packages listed here.
  transpilePackages: ["@ori/shared"],
  experimental: {
    // Next 15 defaults dynamic-segment staleTime to 0: every sidebar
    // click re-runs the role layout server-side, so requireRole()'s two
    // sequential round trips to the (remote) Supabase project —
    // auth.getUser(), then a profiles lookup — fire again before the
    // clicked page even starts fetching its own data. That's the
    // dominant cost behind slow tab switches, not per-page querying.
    // This lets client-side navigation reuse an unchanged layout's
    // already-verified render for 30s (matching lib/providers.tsx's
    // React Query staleTime) instead of re-hitting Supabase each click.
    // A hard reload or a stale-past-30s navigation still re-verifies
    // for real.
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default nextConfig;
