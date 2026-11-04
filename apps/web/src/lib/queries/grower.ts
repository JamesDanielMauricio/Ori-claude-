import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";

import type { TradingDayPhase } from "./trading-day";

// Server reads behind the grower's own screens (today's pick + history),
// each defined once — key + fetch together; see lib/queries/trading-day.ts
// for why the keys matter. growerQueries.pickLines is also what the
// backoffice's "edit a grower's pick" dialogs read, keyed by the pick alone.

export interface OpenTradingDay {
  id: string;
  trade_date: string;
}

export interface DailyPickSummary {
  id: string;
  status: "draft" | "submitted" | "closed";
  submitted_at: string | null;
}

export interface SpecificPick extends DailyPickSummary {
  trading_day_id: string;
  trading_days: { trade_date: string } | null;
}

export interface EmptyTradingDay {
  trade_date: string;
  phase: TradingDayPhase;
}

export interface PickProductLineRow {
  id: string;
  pallets_picked: number;
  leftover_pallets: number;
  comment: string | null;
  product_varieties: {
    name: string;
    sizes: string | null;
    family_id: string;
    product_families: { name: string; image_url: string | null } | null;
  } | null;
}

export interface GrowerHistoryDay {
  id: string;
  trade_date: string;
  // Reverse relation (trading_days -> daily_picks): RLS
  // (daily_picks_select_own) already scopes this to the caller's own
  // company, and the table's `unique(trading_day_id, grower_company_id)`
  // means there is at most one entry here — an array only because that's
  // how PostgREST shapes a one-to-many embed.
  daily_picks: Array<{ id: string; status: "draft" | "submitted" | "closed" }>;
}

// Days per "הצג עוד" batch — about two and a half months of trading. Loading
// every day at once grew with every day the business ran (measured: ~0.8 s
// at 323 days, ~3 s at 1,600 on a laptop, several times that on a phone),
// and a single request past Supabase's 1,000-row cap is silently cut short,
// which would have dropped the oldest days from this list without a word.
const HISTORY_PAGE_SIZE = 60;

export const growerQueries = {
  // The open trading day, as the grower's picks screen needs it (id + date).
  openTradingDay() {
    return queryOptions({
      queryKey: ["grower", "open-trading-day"],
      queryFn: async (): Promise<OpenTradingDay | null> => {
        const { data, error } = await createClient()
          .from("trading_days")
          .select("id, trade_date")
          .neq("phase", "closed")
          .maybeSingle();
        if (error) throw error;
        return data;
      },
    });
  },

  // This grower company's pick for the open day, if one was created for it.
  dailyPick(openDayId: string | undefined, companyId: string | undefined) {
    return queryOptions({
      queryKey: ["grower", "daily-pick", openDayId, companyId],
      enabled: !!openDayId && !!companyId,
      queryFn: async (): Promise<DailyPickSummary | null> => {
        const { data, error } = await createClient()
          .from("daily_picks")
          .select("id, status, submitted_at")
          .eq("trading_day_id", openDayId!)
          .eq("grower_company_id", companyId!)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
    });
  },

  // One specific pick (a history row's link), with its trading day's date.
  pickById(pickId: string) {
    return queryOptions({
      queryKey: ["grower", "pick-by-id", pickId],
      queryFn: async (): Promise<SpecificPick | null> => {
        const { data, error } = await createClient()
          .from("daily_picks")
          .select("id, status, submitted_at, trading_day_id, trading_days(trade_date)")
          .eq("id", pickId)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
    });
  },

  // A trading day's own date/phase, for a history row with no pick behind it.
  tradingDayById(tradingDayId: string) {
    return queryOptions({
      queryKey: ["grower", "trading-day-by-id", tradingDayId],
      queryFn: async (): Promise<EmptyTradingDay | null> => {
        const { data, error } = await createClient()
          .from("trading_days")
          .select("trade_date, phase")
          .eq("id", tradingDayId)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
    });
  },

  // One pick's lines, with each line's variety and family for display.
  pickLines(dailyPickId: string) {
    return queryOptions({
      queryKey: ["grower", "pick-lines", dailyPickId],
      queryFn: async (): Promise<PickProductLineRow[]> => {
        const { data, error } = await createClient()
          .from("daily_pick_products")
          .select(
            "id, pallets_picked, leftover_pallets, comment, product_varieties(name, sizes, family_id, product_families(name, image_url))",
          )
          .eq("daily_pick_id", dailyPickId)
          .order("product_variety_id");
        if (error) throw error;
        return data;
      },
    });
  },

  // Every trading day, newest first, with this company's pick (if any)
  // embedded — see routes/grower/history.tsx for why it starts from
  // trading_days rather than daily_picks.
  pickHistory() {
    return infiniteQueryOptions({
      queryKey: ["grower", "pick-history"],
      initialPageParam: 0,
      queryFn: async ({ pageParam }): Promise<GrowerHistoryDay[]> => {
        const { data, error } = await createClient()
          .from("trading_days")
          .select("id, trade_date, daily_picks(id, status)")
          .order("trade_date", { ascending: false })
          // trade_date isn't unique, and pages are cut by position: without a
          // unique tie-breaker two same-date rows could swap between requests
          // and one would show on both pages while the other showed on none.
          .order("id")
          .range(pageParam, pageParam + HISTORY_PAGE_SIZE - 1);
        if (error) throw error;
        return data;
      },
      // A short page means there is nothing older left.
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length < HISTORY_PAGE_SIZE ? undefined : allPages.length * HISTORY_PAGE_SIZE,
    });
  },
};
