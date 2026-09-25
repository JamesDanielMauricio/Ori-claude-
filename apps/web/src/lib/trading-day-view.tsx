import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { createClient } from "./supabase/client";

export type TradingDayPhase = "initiated" | "shop_open" | "shop_closed" | "closed";

export interface TradingDayView {
  id: string;
  trade_date: string;
  phase: TradingDayPhase;
}

interface SelectedTradingDayState {
  // null = "follow the live trading day" — the ordinary, load-bearing state,
  // and everything every backoffice screen did before this existed. A
  // concrete ISO date pins every date-aware screen to that specific day
  // instead (see useTradingDayView below), whatever its phase.
  selectedDate: string | null;
  setSelectedDate: (date: string | null) => void;
}

const SelectedTradingDayContext = createContext<SelectedTradingDayState | null>(null);

// One selected-date toggle for the whole backoffice area, provided in
// backoffice/layout.tsx above both BackofficeNav and the routed page — so
// picking a date in the sidebar and then navigating to a different
// backoffice screen keeps showing that date rather than resetting to today
// on every click.
//
// A picked date is stored as-is, even on the click that happens to land on
// today's own (live) date — this state only tracks "what did the picker
// last choose," not "is that different from the live day." useTradingDayView
// below is what compares the two to decide whether the result counts as
// live for editing purposes; "חזרה ליום הפעיל" (see BusinessDayPanel) always
// remains the one way to clear the pin back to null and follow the live day
// going forward, regardless of dates matching.
export function SelectedTradingDayProvider({ children }: { children: ReactNode }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Memoized so this provider re-rendering for any other reason doesn't hand
  // every useSelectedTradingDay() consumer a new object reference — setSelectedDate
  // is already stable (it's the setter from useState).
  const value = useMemo(() => ({ selectedDate, setSelectedDate }), [selectedDate]);
  return (
    <SelectedTradingDayContext.Provider value={value}>{children}</SelectedTradingDayContext.Provider>
  );
}

export function useSelectedTradingDay(): SelectedTradingDayState {
  const context = useContext(SelectedTradingDayContext);
  if (!context) {
    throw new Error("useSelectedTradingDay must be used inside SelectedTradingDayProvider");
  }
  return context;
}

// One shared query key for "the live open trading day" — the same row
// BusinessDayPanel's lifecycle buttons have always operated on, unaffected
// by anything pinned in the picker. Every date-aware screen's
// useTradingDayView (below) reads it too when nothing is pinned, and
// because TanStack Query dedupes by key regardless of which component
// calls useQuery, every screen sharing this key shares one request and one
// cache entry rather than each re-fetching "is there an open day" on its
// own.
export const OPEN_TRADING_DAY_QUERY_KEY = ["trading-day", "open"] as const;

export function useOpenTradingDay() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  // This hook is mounted by more than one component at once — BusinessDayPanel
  // (always in the sidebar) plus whatever routed screen also calls it through
  // useTradingDayView below. supabase-js keys its channel registry by topic
  // name and reuses the same channel object for a repeated `.channel(name)`
  // call, so a shared literal name here meant the second mounted instance's
  // `.on()` landed on a channel the first instance had already subscribed —
  // which supabase-js rejects outright ("cannot add postgres_changes
  // callbacks... after subscribe()"), crashing the whole page. useId gives
  // each mounted instance its own channel instead.
  const instanceId = useId();

  const query = useQuery({
    queryKey: OPEN_TRADING_DAY_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("id, trade_date, phase")
        .neq("phase", "closed")
        .maybeSingle();
      if (error) throw error;
      return data as TradingDayView | null;
    },
    // Matches BusinessDayPanel's original polling — this is now the one
    // place that interval is declared, rather than a second copy of it.
    // Kept alongside the realtime push below as a fallback for the rare
    // dropped-websocket case, not replaced by it.
    refetchInterval: 60000,
  });

  // Push-triggered version of the same polling: a lifecycle transition
  // (open/close a day) is exactly the kind of change every mounted
  // date-aware screen needs to see immediately, not up to 60s later. Same
  // trigger-only shape as order-lines-editor.tsx's subscription (see
  // packages/db/migrations/0041_expand-realtime-publication.sql) — the
  // payload is never read, only used to know "re-run the query".
  useEffect(() => {
    const channel = supabase
      .channel(`trading-days-open-${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trading_days" },
        () => {
          void queryClient.invalidateQueries({ queryKey: OPEN_TRADING_DAY_QUERY_KEY });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  return query;
}

// The day every date-aware backoffice screen (Shop, Arrangement, Grower
// Inventory Status, Customer Order Status) actually renders: the live open
// day by default, or — once the sidebar's picker has pinned one — the
// trading_days row for that specific date, whatever its phase.
//
// `isLive` is what those screens gate their own editing controls on, not
// the resolved day's own phase or status. A pinned day is read-only through
// these screens UNLESS the pinned date is the live day's own date — picking
// today's date in the calendar is meant to land you back on today, editable,
// not on a frozen read-only copy of it — even though the row is read via
// `pinnedQuery` rather than `openDayQuery` in that case (see `active` below).
export function useTradingDayView() {
  const supabase = createClient();
  const { selectedDate } = useSelectedTradingDay();
  const openDayQuery = useOpenTradingDay();

  const pinnedQuery = useQuery({
    queryKey: ["trading-day", "by-date", selectedDate],
    enabled: selectedDate !== null,
    queryFn: async () => {
      // Ordered and capped at one rather than a bare .maybeSingle(): trade_date
      // carries no unique constraint of its own (only the partial "at most one
      // non-closed day" index, trading_days_single_open_idx — packages/db/
      // migrations/0009_lifecycle-schema.sql), so two closed days could in
      // principle share a date. Most-recently-created is the same tie-break a
      // person would reach for.
      const { data, error } = await supabase
        .from("trading_days")
        .select("id, trade_date, phase")
        .eq("trade_date", selectedDate!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as TradingDayView | null;
    },
  });

  // Live if nothing is pinned, OR the pinned date happens to equal the open
  // day's own date — comparing against openDayQuery.data (not pinnedQuery's
  // row) because that's the one query that always reflects "which date is
  // currently the live one," independent of whichever row pinnedQuery below
  // resolves to.
  const isLive =
    selectedDate === null || selectedDate === (openDayQuery.data?.trade_date ?? null);
  // `day` itself still always comes from whichever query matches the picker's
  // own state (openDayQuery when nothing is pinned, pinnedQuery once
  // something is) — isLive above only changes whether that day is editable,
  // not which query is the source of it.
  const active = selectedDate === null ? openDayQuery : pinnedQuery;

  return {
    day: active.data ?? null,
    isLive,
    isLoading: active.isLoading,
    isError: active.isError,
    // Failed before ever loading — unlike `isError`, false when only a
    // background refetch failed and the day already on screen is still
    // good. What a screen should check before replacing itself with an
    // error rather than showing what it has.
    isLoadError: active.isLoadingError,
    isFetching: active.isFetching,
    refetch: active.refetch,
    // For the picker's displayed value before the user has ever touched it,
    // and for the "back to current" affordance's own label.
    openDay: openDayQuery.data ?? null,
  };
}

export interface TradingDaySummary {
  trade_date: string;
  phase: TradingDayPhase;
}

// Which dates in one visible calendar month actually have a trading day —
// TradingDayCalendarPicker's own data, kept out of that component so the
// query (and its cache) is reusable if anything else ever needs "which days
// in this range have a trading day" instead of a component internal. Ranged
// rather than fetching every trading day ever: the table only grows, and a
// calendar only ever shows one month at a time, so there is nothing to gain
// from holding years of dates the grid can't display anyway. Each visited
// month is its own cache entry (keyed by its bounds), so paging back to a
// month already seen this session costs nothing.
export function useTradingDaysInRange(startDate: string, endDate: string) {
  const supabase = createClient();
  return useQuery({
    queryKey: ["trading-day", "range", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("trade_date, phase")
        .gte("trade_date", startDate)
        .lte("trade_date", endDate);
      if (error) throw error;
      return data as TradingDaySummary[];
    },
  });
}
