import { queryOptions } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";

// Server reads behind the backoffice's order history screen (one date →
// every customer's order → one order's lines with what was arranged), each
// defined once — key + fetch together; see lib/queries/trading-day.ts for
// why the keys matter. RLS (daily_orders_select_backoffice,
// arrangement_records_select_backoffice) is what scopes these to the
// backoffice role.

export interface HistoryOrderRow {
  id: string;
  status: "open" | "submitted";
  submitted_at: string | null;
  companies: { name: string } | null;
}

export interface HistoryOrderLineRow {
  id: string;
  pallets_ordered: number;
  comment: string | null;
  product_varieties: {
    name: string;
    sizes: string | null;
    product_families: { name: string } | null;
  } | null;
  arrangement_records: Array<{ quantity_pallets: number; price: number | null }>;
}

export const orderHistoryQueries = {
  // The trading day on one date — most recently created, since trade_date
  // carries no unique constraint of its own.
  tradingDay(date: string | null) {
    return queryOptions({
      queryKey: ["order-history", "trading-day", date],
      enabled: date !== null,
      queryFn: async (): Promise<{ id: string; trade_date: string } | null> => {
        const { data, error } = await createClient()
          .from("trading_days")
          .select("id, trade_date")
          .eq("trade_date", date!)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
    });
  },

  // Every customer's order on that day.
  orders(dayId: string | undefined) {
    return queryOptions({
      queryKey: ["order-history", "orders", dayId],
      enabled: !!dayId,
      queryFn: async (): Promise<HistoryOrderRow[]> => {
        const { data, error } = await createClient()
          .from("daily_orders")
          .select("id, status, submitted_at, companies(name)")
          .eq("trading_day_id", dayId!);
        if (error) throw error;
        return data;
      },
    });
  },

  // One order's lines, each with what was arranged against it.
  lines(orderId: string | null) {
    return queryOptions({
      queryKey: ["order-history", "lines", orderId],
      enabled: !!orderId,
      queryFn: async (): Promise<HistoryOrderLineRow[]> => {
        const { data, error } = await createClient()
          .from("daily_order_products")
          .select(
            "id, pallets_ordered, comment, product_varieties(name, sizes, product_families(name)), arrangement_records(quantity_pallets, price)",
          )
          .eq("daily_order_id", orderId!)
          .order("product_variety_id");
        if (error) throw error;
        return data;
      },
    });
  },
};
