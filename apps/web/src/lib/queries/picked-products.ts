import { queryOptions } from "@tanstack/react-query";

import { parsePallets } from "@/components/arrangement/board-data";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { createClient } from "@/lib/supabase/client";

// The server read behind "מוצרים שנקטפו" (the Products screen narrowed to a
// day's real supply), defined once — key + fetch together; see
// lib/queries/trading-day.ts for why the keys matter.

// A stable empty set for "the day has nothing / we don't know yet", so the
// filtered table's own useMemo isn't handed a new Set on every render.
// Exported so the screen's "still loading" fallback is this same object.
export const NO_VARIETIES: ReadonlySet<string> = new Set<string>();

// One grower's pick line for the day. Read through parsePallets below rather
// than a bare `> 0`, the same reading every pallet total in the app uses.
interface PickLine {
  product_variety_id: string;
  pallets_picked: number;
  leftover_pallets: number;
}

export const pickedProductsQueries = {
  // Which varieties had supply on a day: a pick line with `pallets_picked >
  // 0` OR `leftover_pallets > 0` (see routes/backoffice/picked-products.tsx
  // for why merely having a pick line doesn't count).
  //
  // Two round trips rather than one nested read: the pick lines for a busy
  // day can outrun PostgREST's 1000-row cap (~78 families × several
  // growers), and that cap TRUNCATES rather than erroring — a short read here
  // would quietly drop products off the list. fetchAllRows pages until a
  // short page arrives.
  varietiesForDay(dayId: string | null) {
    return queryOptions({
      queryKey: ["picked-products", "varieties", dayId],
      enabled: !!dayId,
      queryFn: async (): Promise<ReadonlySet<string>> => {
        const supabase = createClient();
        const picks = await supabase.from("daily_picks").select("id").eq("trading_day_id", dayId!);
        if (picks.error) throw picks.error;

        const pickIds = picks.data.map((pick) => pick.id);
        if (pickIds.length === 0) return NO_VARIETIES;

        const lines = await fetchAllRows<PickLine>((from, to) =>
          supabase
            .from("daily_pick_products")
            .select("product_variety_id, pallets_picked, leftover_pallets")
            // Ordered so paging is stable: without an ORDER BY, Postgres is free
            // to return the same row on two pages and skip another entirely.
            .order("id")
            .in("daily_pick_id", pickIds)
            .range(from, to),
        );

        const picked = new Set<string>();
        for (const line of lines) {
          if (parsePallets(line.pallets_picked) > 0 || parsePallets(line.leftover_pallets) > 0) {
            picked.add(line.product_variety_id);
          }
        }
        return picked;
      },
    });
  },
};
