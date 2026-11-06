import { queryOptions } from "@tanstack/react-query";

import type {
  BoardCompany,
  BoardOrder,
  BoardPick,
  BoardRecord,
} from "@/components/arrangement/board-data";
import { fetchAllRows, PAGE_SIZE } from "@/lib/fetch-all-rows";
import { createClient } from "@/lib/supabase/client";

// Server reads behind the two arrangement screens — the board
// (/backoffice/arrangement) and the product × customer grid
// (/backoffice/new-arrangement) — and the price dialog launched from the
// board. Each is defined once, key + fetch together; see
// lib/queries/trading-day.ts for why the keys matter.
//
// The prefixes are what the screens refresh: a write on the grid refreshes
// both boards' whole-day entries (they read the same records out of two
// cache entries), and a price change refreshes everything under
// `arrangementKeys.all`.

export const arrangementKeys = {
  all: ["arrangement"] as const,
  boardDataAll: ["arrangement", "board-data"] as const,
  boardData: (dayId: string | null) => ["arrangement", "board-data", dayId] as const,
  companies: ["arrangement", "companies"] as const,
  priceVariety: (varietyId: string | null) =>
    ["arrangement", "product-variety", varietyId] as const,
  priceCaps: (varietyId: string | null) =>
    ["arrangement", "product-customer-caps", varietyId] as const,
};

export const newArrangementKeys = {
  matrixAll: ["new-arrangement", "matrix"] as const,
  matrix: (dayId: string | null) => ["new-arrangement", "matrix", dayId] as const,
};

// One trading day with everything both arrangement screens draw from it, as
// ONE nested row — see boardData() below for why this is a single shape
// rather than seven separate queries.
export interface ArrangementDay {
  id: string;
  trade_date: string;
  phase: "initiated" | "shop_open" | "shop_closed" | "closed";
  // `unique(trading_day_id)` on daily_arrangements makes this a
  // one-to-one embed, so PostgREST returns an object here, not an array.
  daily_arrangements: DailyArrangement | null;
  daily_picks: BoardPick[];
  daily_orders: BoardOrder[];
}

interface DailyArrangement {
  id: string;
  status: "open" | "closed";
  arrangement_records: BoardRecord[];
}

export interface ProductVarietyRow {
  id: string;
  family_id: string;
  name: string;
  sizes: string | null;
  pack_type: "pallets" | "crates" | null;
  price: number | null;
  price_range_from: number | null;
  price_range_to: number | null;
  price_type: string | null;
  no_overbooking: number;
  highlight_price_fluctuations: boolean;
  is_seasonal_available: boolean;
  number_of_orders_per_customer: number | null;
  version: number;
}

const RECORD_COLUMNS =
  "id, daily_pick_product_id, daily_order_product_id, customer_company_id, quantity_pallets, price, price_type";

// Supabase's 1,000-row cap (max_rows) cuts a NESTED list too, silently —
// proven by the domain test "the 1,000-row cap cuts each nested list on its
// own" (packages/domain/src/grower/grower.test.ts). Of the lists in the day
// tree, the day's arrangement records are the one that can outgrow it — one
// record per (grower's line → customer's line) assignment, across the whole
// day — and a cut list would show assigned pallets as unassigned on both
// boards. Every other list is one grower's or one customer's lines (at most
// the ~900-variety catalog), one customer's submissions that day, or a
// per-day count of companies.
//
// So: when the records come back exactly full, they may be cut, and they
// are re-read on their own, in pages, by the arrangement's id. A normal day
// is far below 1,000 and costs nothing extra; only a day that reaches the
// cap pays one more round trip. The shape handed back is unchanged, so both
// boards and their optimistic updates work as before.
async function completeArrangementRecords(
  day: ArrangementDay | null,
): Promise<ArrangementDay | null> {
  const arrangement = day?.daily_arrangements;
  if (!day || !arrangement || arrangement.arrangement_records.length < PAGE_SIZE) return day;
  const records = await fetchAllRows<BoardRecord>((from, to) =>
    createClient()
      .from("arrangement_records")
      .select(RECORD_COLUMNS)
      .eq("daily_arrangement_id", arrangement.id)
      .order("id")
      .range(from, to),
  );
  return { ...day, daily_arrangements: { ...arrangement, arrangement_records: records } };
}

export const arrangementQueries = {
  // Everything the board needs in ONE request, once the day is known. Every
  // table here hangs off that day by a foreign key, so PostgREST can
  // return the entire tree in a single round trip — the arrangement +
  // records, every grower's pick and pick lines, every customer's order
  // and order lines, and each line's variety/family for labelling.
  //
  // This replaced a 7-query chain that was 3 round trips deep: the day had
  // to land before picks/orders could be asked for, and those had to land
  // before the varieties they referenced could be looked up. None of that
  // was a real data dependency — the children all key off the day's id,
  // which PostgREST already knows how to follow. Measured against this
  // project's Supabase region (ap-northeast-1), each hop cost ~130-300ms,
  // so the waterfall was the dominant cost of opening this screen, not the
  // query work itself.
  //
  // The redesign added four fields to this same tree rather than a second
  // query for any of them: pick/order `status` (the cards' state chips),
  // `pickup_time` (the growers column is ordered by collection time),
  // per-line `comment` (shown under the line it belongs to, as in the
  // reference), and the family's `image_url` (migration 0036) for the
  // product photos. All are columns on rows already being fetched, so the
  // request count is unchanged.
  //
  // Also embedded per order: `order_submission_logs`, the append-only audit
  // trail submit_order already writes on every customer submission (0017,
  // "for dispute resolution"). The customer list uses it to show a line's
  // pallet count next to what it was one submission ago, so a distributor
  // can see "they just changed this" instead of only ever seeing the latest
  // number. Still one request — it's a fourth child table alongside picks,
  // orders and records, not a second query.
  //
  // `companies` stays separate (companies() below): it's whole-table
  // reference data with no dependency on the day, so it starts immediately
  // and resolves in parallel rather than adding a hop.
  boardData(dayId: string | null) {
    return queryOptions({
      queryKey: arrangementKeys.boardData(dayId),
      enabled: !!dayId,
      queryFn: async (): Promise<ArrangementDay | null> => {
        const { data, error } = await createClient()
          .from("trading_days")
          .select(
            `id, trade_date, phase,
           daily_arrangements(id, status, arrangement_records(id, daily_pick_product_id, daily_order_product_id, customer_company_id, quantity_pallets, price, price_type)),
           daily_picks(id, grower_company_id, status, submitted_at, pickup_time, daily_pick_products(id, daily_pick_id, product_variety_id, pallets_picked, leftover_pallets, comment, product_varieties(id, name, sizes, family_id, product_families(name, image_url)))),
           daily_orders(id, customer_company_id, status, daily_order_products(id, daily_order_id, product_variety_id, pallets_ordered, comment, product_varieties(id, name, sizes, family_id, product_families(name, image_url))), order_submission_logs(id, snapshot, created_at))`,
          )
          .eq("id", dayId!)
          .maybeSingle();
        if (error) throw error;
        // numeric columns come back as bare JSON numbers over PostgREST, not
        // decimal-preserving strings — see packages/db/src/supabase-types.ts.
        return completeArrangementRecords(data);
      },
    });
  },

  // The same day for the product × customer grid, in ONE request — see
  // boardData() for why it is a single nested read rather than a chain of
  // dependent ones. `order_submission_logs` is the one thing that tree
  // carries and this one does not: the "changed since their last
  // submission" flag it feeds has nowhere to go in a grid cell.
  matrix(dayId: string | null) {
    return queryOptions({
      queryKey: newArrangementKeys.matrix(dayId),
      enabled: !!dayId,
      queryFn: async (): Promise<ArrangementDay | null> => {
        const { data, error } = await createClient()
          .from("trading_days")
          .select(
            `id, trade_date, phase,
           daily_arrangements(id, status, arrangement_records(id, daily_pick_product_id, daily_order_product_id, customer_company_id, quantity_pallets, price, price_type)),
           daily_picks(id, grower_company_id, status, pickup_time, daily_pick_products(id, daily_pick_id, product_variety_id, pallets_picked, leftover_pallets, comment, product_varieties(id, name, sizes, family_id, product_families(name, image_url)))),
           daily_orders(id, customer_company_id, status, daily_order_products(id, daily_order_id, product_variety_id, pallets_ordered, comment, product_varieties(id, name, sizes, family_id, product_families(name, image_url))))`,
          )
          .eq("id", dayId!)
          .maybeSingle();
        if (error) throw error;
        return completeArrangementRecords(data);
      },
    });
  },

  // Growers' and customers' names (and growers' pickup times) — whole-table
  // reference data with no dependency on the day, shared by both screens.
  companies() {
    return queryOptions({
      queryKey: arrangementKeys.companies,
      queryFn: async (): Promise<BoardCompany[]> => {
        const { data, error } = await createClient()
          .from("companies")
          .select("id, name, default_pickup_time")
          .in("type", ["grower", "customer"]);
        if (error) throw error;
        return data;
      },
    });
  },

  // The one variety the price dialog edits, with its family's name.
  priceVariety(varietyId: string | null) {
    return queryOptions({
      queryKey: arrangementKeys.priceVariety(varietyId),
      enabled: !!varietyId,
      queryFn: async (): Promise<
        ProductVarietyRow & { product_families: { name: string } | null }
      > => {
        const { data, error } = await createClient()
          .from("product_varieties")
          .select(
            "id, family_id, name, sizes, pack_type, price, price_range_from, price_range_to, price_type, no_overbooking, highlight_price_fluctuations, is_seasonal_available, number_of_orders_per_customer, version, product_families(name)",
          )
          .eq("id", varietyId!)
          .single();
        if (error) throw error;
        return data;
      },
    });
  },

  // That variety's per-customer pallet caps — save_product rewrites them
  // with every save, so the dialog has to send them back unchanged.
  priceCaps(varietyId: string | null) {
    return queryOptions({
      queryKey: arrangementKeys.priceCaps(varietyId),
      enabled: !!varietyId,
      queryFn: async () => {
        const { data, error } = await createClient()
          .from("product_customer_caps")
          .select("customer_company_id, pallet_cap")
          .eq("product_variety_id", varietyId!);
        if (error) throw error;
        return data.map((row) => ({
          customerCompanyId: row.customer_company_id,
          palletCap: row.pallet_cap,
        }));
      },
    });
  },
};
