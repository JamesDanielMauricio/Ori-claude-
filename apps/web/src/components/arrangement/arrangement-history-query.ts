// The reads the arrangement engine needs beyond the day on screen: the last
// HISTORY_DAYS trading days, the owner's scores and when each customer
// started. Straight from the tables under the user's own session — a
// backoffice login reads all of them (see packages/domain's arrangement
// module header) — and only when "הצע סידור" is pressed: kept out of React
// Query on purpose, because lib/live-updates.ts re-reads every mounted query
// on any write anywhere, and two months of history has no business being
// fetched again each time a cell is typed.
import type { PostgrestError } from "@supabase/supabase-js";

import type { createClient } from "@/lib/supabase/client";

import type { CustomerFacts, HistoryDay } from "./arrangement-engine";
import {
  customerFactsFrom,
  historyFromRows,
  readAllPages,
  type HistoryRows,
} from "./arrangement-engine-input";

/** How far back the engine learns from. The owner's "about two months". */
export const HISTORY_DAYS = 60;

type Client = ReturnType<typeof createClient>;

/** Every row of one query, paged (see readAllPages). */
function allRows<T>(
  read: (from: number, to: number) => PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<T[]> {
  return readAllPages(async (from, to) => {
    const { data, error } = await read(from, to);
    if (error) throw error;
    return (data ?? []) as T[];
  });
}

export async function readEngineHistory(
  supabase: Client,
  tradeDate: string,
): Promise<{
  history: HistoryDay[];
  familyOf: Record<string, string>;
  customers: Record<string, CustomerFacts>;
}> {
  const from = new Date(Date.parse(tradeDate) - HISTORY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const daysRead = await supabase
    .from("trading_days")
    .select("id, trade_date, daily_arrangements(status)")
    .gte("trade_date", from)
    .lt("trade_date", tradeDate)
    .order("trade_date");
  if (daysRead.error) throw daysRead.error;
  const days = (daysRead.data ?? []) as unknown as HistoryRows["days"];
  const dayIds = days.map((day) => day.id);

  const [pickLines, orderLines, records, scores, customers] = await Promise.all([
    dayIds.length === 0
      ? []
      : allRows<HistoryRows["pickLines"][number]>((start, end) =>
          supabase
            .from("daily_pick_products")
            .select(
              "id, product_variety_id, pallets_picked, leftover_pallets, daily_picks!inner(trading_day_id), product_varieties(family_id)",
            )
            .in("daily_picks.trading_day_id", dayIds)
            .or("pallets_picked.gt.0,leftover_pallets.gt.0")
            .order("id")
            .range(start, end),
        ),
    dayIds.length === 0
      ? []
      : allRows<HistoryRows["orderLines"][number]>((start, end) =>
          supabase
            .from("daily_order_products")
            .select(
              "id, product_variety_id, pallets_ordered, daily_orders!inner(trading_day_id, customer_company_id), product_varieties(family_id)",
            )
            .in("daily_orders.trading_day_id", dayIds)
            .gt("pallets_ordered", 0)
            .order("id")
            .range(start, end),
        ),
    dayIds.length === 0
      ? []
      : allRows<HistoryRows["records"][number]>((start, end) =>
          supabase
            .from("arrangement_records")
            .select(
              "id, quantity_pallets, customer_company_id, daily_arrangements!inner(trading_day_id), daily_pick_products(product_variety_id, product_varieties(family_id)), daily_order_products(daily_orders(customer_company_id))",
            )
            .in("daily_arrangements.trading_day_id", dayIds)
            .gt("quantity_pallets", 0)
            .order("id")
            .range(start, end),
        ),
    allRows<{ customer_company_id: string; general_score: string | number }>((start, end) =>
      supabase
        .from("customer_scores")
        .select("customer_company_id, general_score")
        .order("customer_company_id")
        .range(start, end),
    ),
    allRows<{ id: string; created_at: string }>((start, end) =>
      supabase
        .from("companies")
        .select("id, created_at")
        .eq("type", "customer")
        .order("id")
        .range(start, end),
    ),
  ]);

  const { history, familyOf } = historyFromRows({ days, pickLines, orderLines, records });
  return { history, familyOf, customers: customerFactsFrom({ customers, scores }) };
}
