import { useQuery } from "@tanstack/react-query";

import { parsePallets } from "@/components/arrangement/board-data";
import { ProductCatalogScreen } from "@/components/reference-data/product-catalog-screen";
import { StatusPill } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { createClient } from "@/lib/supabase/client";
import { useTradingDayView } from "@/lib/trading-day-view";

const TITLE = "מוצרים שנקטפו";
const SUBTITLE =
  "אותו קטלוג, מצומצם למוצרים שיש מהם מלאי ביום המסחר שנבחר בסרגל הצד. העריכה נשמרת על המוצר עצמו — היא אינה מוגבלת ליום.";

// A stable empty set for "the day has nothing / we don't know yet", so the
// filtered table's own useMemo isn't handed a new Set on every render.
const NO_VARIETIES: ReadonlySet<string> = new Set<string>();

// One grower's pick line for the day. `pallets_picked` and `leftover_pallets`
// are Postgres `numeric`, which PostgREST sends as strings — hence
// parsePallets below rather than a bare `> 0`.
interface PickLine {
  product_variety_id: string;
  pallets_picked: string;
  leftover_pallets: string;
}

// "מוצרים שנקטפו" — the Products screen narrowed to the day's real supply.
//
// The day comes from the sidebar's picker, the same way Shop, Arrangement and
// the two on-behalf-of screens resolve theirs (lib/trading-day-view.tsx), so
// pinning a past date narrows this list to what was picked THAT day.
//
// "Picked" here means the same thing the arrangement screens mean by available
// supply: a pick line with `pallets_picked > 0` OR `leftover_pallets > 0`.
// Merely HAVING a pick line is not enough and would make this tab pointless —
// `bootstrap_grower_pick` creates a line for every in-season product of every
// active grower when the day opens (migration 0014), so an unfiltered list is
// "what is in season", which is nearly the whole catalog. Leftover counts
// because it is arrangeable stock: `pallets_picked + leftover_pallets` is what
// `check_arrangement_allocation` allows to be given away (migration 0050).
export default function PickedProductsPage() {
  const supabase = createClient();
  const dayView = useTradingDayView();
  const day = dayView.day;

  // Two round trips rather than one nested read: the pick lines for a busy day
  // can outrun PostgREST's 1000-row cap (~78 families × several growers), and
  // that cap TRUNCATES rather than erroring — a short read here would quietly
  // drop products off the list. fetchAllRows pages until a short page arrives.
  const pickedQuery = useQuery({
    queryKey: ["picked-products", "varieties", day?.id ?? null],
    enabled: !!day?.id,
    queryFn: async () => {
      const picks = await supabase.from("daily_picks").select("id").eq("trading_day_id", day!.id);
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
      return picked as ReadonlySet<string>;
    },
  });

  // A failure is reported as a failure, never as "nothing was picked today":
  // that sentence is operationally significant here — it is the one a
  // distributor would act on by assuming the growers have not submitted yet.
  if (dayView.isError || pickedQuery.isError) {
    return (
      <>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        {dayView.isError ? (
          <QueryError
            what="יום המסחר"
            onRetry={() => void dayView.refetch()}
            retrying={dayView.isFetching}
          />
        ) : (
          <QueryError
            what="רשימות הליקוט של היום"
            onRetry={() => void pickedQuery.refetch()}
            retrying={pickedQuery.isFetching}
          />
        )}
      </>
    );
  }

  const tradeDateLabel = day
    ? new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(day.trade_date))
    : null;

  return (
    <ProductCatalogScreen
      title={TITLE}
      subtitle={SUBTITLE}
      // Which day these rows came from. Unlike the other date-aware screens
      // this one does NOT add "לא ניתן לערוך" when a past day is pinned: the
      // DAY decides which products are listed, but the records themselves are
      // catalog records with no day of their own, so editing one from here is
      // the same edit as from /backoffice/products and stays allowed.
      headerActions={
        <>
          {tradeDateLabel && <StatusPill tone="neutral">{tradeDateLabel}</StatusPill>}
          {!dayView.isLive && <StatusPill tone="warning">יום מסחר קודם</StatusPill>}
        </>
      }
      varietyIds={pickedQuery.data ?? NO_VARIETIES}
      extraLoading={dayView.isLoading || pickedQuery.isLoading}
      emptyLabel={
        day
          ? "לא נקטפו מוצרים ביום המסחר הזה."
          : dayView.isLive
            ? "אין יום מסחר פתוח."
            : "לא נמצא יום מסחר בתאריך שנבחר."
      }
    />
  );
}
