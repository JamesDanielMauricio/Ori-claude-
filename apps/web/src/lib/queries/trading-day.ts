import { queryOptions } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";

// Every server read about trading days, each defined once: the cache key and
// the function that fetches it, together. Screens call
// `useQuery(tradingDayQueries.open())` instead of spelling out a key and a
// fetch of their own, so two screens can never cache different data under
// the same key, and a key can only be changed in one place.
//
// The keys themselves are load-bearing: TanStack Query shares one cache
// entry (and one request) between every screen asking for the same key, and
// invalidating a key PREFIX refreshes every entry under it — BusinessDayPanel
// refreshes all of `tradingDayKeys.all` when a day changes phase. Change a
// key and you change what gets shared and what gets refreshed.

export type TradingDayPhase = "initiated" | "shop_open" | "shop_closed" | "closed";

export interface TradingDayView {
  id: string;
  trade_date: string;
  phase: TradingDayPhase;
}

export interface TradingDaySummary {
  trade_date: string;
  phase: TradingDayPhase;
}

export const tradingDayKeys = {
  all: ["trading-day"] as const,
  // One shared key for "the live open trading day" — the same row
  // BusinessDayPanel's lifecycle buttons have always operated on, unaffected
  // by anything pinned in the picker. Every date-aware screen's
  // useTradingDayView reads it too when nothing is pinned, and because
  // TanStack Query dedupes by key regardless of which component calls
  // useQuery, every screen sharing this key shares one request and one cache
  // entry rather than each re-fetching "is there an open day" on its own.
  open: ["trading-day", "open"] as const,
  byDate: (date: string | null) => ["trading-day", "by-date", date] as const,
  range: (startDate: string, endDate: string) =>
    ["trading-day", "range", startDate, endDate] as const,
};

// The live open trading day's row — at most one (trading_days_single_open_idx).
// Shared by tradingDayQueries.open and by anything that must check the day's
// phase fresh at the moment it acts (see OrderLinesEditor's submit).
export async function fetchOpenTradingDay(): Promise<TradingDayView | null> {
  const { data, error } = await createClient()
    .from("trading_days")
    .select("id, trade_date, phase")
    .neq("phase", "closed")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export const tradingDayQueries = {
  open() {
    return queryOptions({
      queryKey: tradingDayKeys.open,
      queryFn: fetchOpenTradingDay,
      // No polling interval. This used to re-read every 60 seconds on every
      // open device, used or not; it is now re-read when the day actually
      // changes (lib/live-updates.ts) or someone comes back to the app
      // (lib/refresh-on-return.ts).
    });
  },

  // The trading_days row for one specific date, whatever its phase — what a
  // date pinned in the sidebar's picker resolves to (useTradingDayView).
  byDate(selectedDate: string | null) {
    return queryOptions({
      queryKey: tradingDayKeys.byDate(selectedDate),
      enabled: selectedDate !== null,
      queryFn: async (): Promise<TradingDayView | null> => {
        // Ordered and capped at one rather than a bare .maybeSingle(): trade_date
        // carries no unique constraint of its own (only the partial "at most one
        // non-closed day" index, trading_days_single_open_idx — packages/db/
        // migrations/0009_lifecycle-schema.sql), so two closed days could in
        // principle share a date. Most-recently-created is the same tie-break a
        // person would reach for.
        const { data, error } = await createClient()
          .from("trading_days")
          .select("id, trade_date, phase")
          .eq("trade_date", selectedDate!)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
    });
  },

  // Which dates in one visible calendar month actually have a trading day.
  // Ranged rather than fetching every trading day ever: the table only grows,
  // and a calendar only ever shows one month at a time. Each visited month is
  // its own cache entry (keyed by its bounds), so paging back to a month
  // already seen this session costs nothing.
  range(startDate: string, endDate: string) {
    return queryOptions({
      queryKey: tradingDayKeys.range(startDate, endDate),
      queryFn: async (): Promise<TradingDaySummary[]> => {
        const { data, error } = await createClient()
          .from("trading_days")
          .select("trade_date, phase")
          .gte("trade_date", startDate)
          .lte("trade_date", endDate);
        if (error) throw error;
        return data;
      },
    });
  },
};
