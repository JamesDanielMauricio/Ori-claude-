import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { tradingDayQueries } from "./queries/trading-day";

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

// The live open trading day (see tradingDayQueries.open). Kept current by
// lib/live-updates.ts, like every other query: a day started, opened or
// closed on one device shows up on every other open device within about a
// second.
export function useOpenTradingDay() {
  return useQuery(tradingDayQueries.open());
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
  const { selectedDate } = useSelectedTradingDay();
  const openDayQuery = useOpenTradingDay();

  const pinnedQuery = useQuery(tradingDayQueries.byDate(selectedDate));

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

// Which dates in one visible calendar month actually have a trading day —
// TradingDayCalendarPicker's own data (see tradingDayQueries.range).
export function useTradingDaysInRange(startDate: string, endDate: string) {
  return useQuery(tradingDayQueries.range(startDate, endDate));
}
