import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { weekdayDateLabel } from "@/components/customer/catalog-grouping";
import { OrderLinesEditor } from "@/components/customer/order-lines-editor";
import { OrderProductList, type OrderFamilyRow } from "@/components/customer/order-product-list";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";

// Customer-facing catalog browsing + order placement (PRD:
// place-edit-today-s-order.md, order-form.md). The actual catalog/draft/
// submit logic lives in OrderLinesEditor, shared with the distributor's
// Customer Order Status oversight screen (/backoffice/distributor-customer)
// — see that component's header comment.
//
// An `?orderId=` search param (set by history.tsx's row links) shows a
// specific past order's content here instead of today's open one — live
// and editable if its trading day hasn't closed yet (submit_order allows
// re-submitting up to that point, same as the default view), read-only
// once it has.
export default function CustomerOrderPage() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("orderId");

  if (orderId) {
    return <SpecificOrderView orderId={orderId} />;
  }
  return <TodayOrderView />;
}

function TodayOrderView() {
  const supabase = createClient();

  const openDayQuery = useQuery({
    queryKey: ["customer", "open-trading-day"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("id, trade_date")
        .neq("phase", "closed")
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; trade_date: string } | null;
    },
  });
  const dayId = openDayQuery.data?.id;

  const tradeDateLabel = useMemo(() => {
    if (!openDayQuery.data) return "";
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(
      new Date(openDayQuery.data.trade_date),
    );
  }, [openDayQuery.data]);

  if (openDayQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!dayId) {
    return <p className="text-sm text-ink-muted">אין יום מסחר פתוח כרגע.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title={`הזמנה — ${tradeDateLabel}`}
        subtitle="עדכן כמויות ולחץ שמירה — ההזמנה נשלחת רק לאחר אישור הסיכום."
      />
      <OrderLinesEditor tradingDayId={dayId} tradeDate={openDayQuery.data!.trade_date} />
    </div>
  );
}

interface SpecificOrder {
  id: string;
  status: "open" | "submitted";
  submitted_at: string | null;
  trading_day_id: string;
  trading_days: { trade_date: string; phase: "initiated" | "shop_open" | "shop_closed" | "closed" } | null;
}

function SpecificOrderView({ orderId }: { orderId: string }) {
  const supabase = createClient();

  const orderQuery = useQuery({
    queryKey: ["customer", "order-by-id", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_orders")
        .select("id, status, submitted_at, trading_day_id, trading_days(trade_date, phase)")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SpecificOrder | null;
    },
  });

  if (orderQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const order = orderQuery.data;
  // Either a bad id, or RLS (daily_orders_select_own) filtered out a row
  // that isn't this customer's own — same "not found" message either way,
  // rather than distinguishing "doesn't exist" from "not yours" to a caller
  // who shouldn't learn which.
  if (!order || !order.trading_days) {
    return <p className="text-sm text-ink-muted">ההזמנה לא נמצאה.</p>;
  }

  // Trading day not closed yet: reuse the exact same live, editable editor
  // the default (no orderId) view renders — submit_order allows
  // re-submitting an already-"submitted" order up until the day closes, so
  // "sent" orders are still editable here too, not just "new" drafts.
  if (order.trading_days.phase !== "closed") {
    return (
      <div className="flex flex-col gap-2">
        <PageHeader
          title={`הזמנה — ${new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(order.trading_days.trade_date))}`}
          subtitle="עדכן כמויות ולחץ שמירה — ההזמנה נשלחת רק לאחר אישור הסיכום."
        />
        <OrderLinesEditor tradingDayId={order.trading_day_id} tradeDate={order.trading_days.trade_date} />
      </div>
    );
  }

  return <ClosedOrderView order={order} />;
}

interface HistoricalLineRow {
  id: string;
  pallets_ordered: number;
  comment: string | null;
  product_varieties: {
    name: string;
    family_id: string;
    pack_type: "pallets" | "crates" | null;
    product_families: { name: string; image_url: string | null } | null;
  } | null;
}

const STATUS_LABEL: Record<SpecificOrder["status"], string> = {
  open: "טיוטה",
  submitted: "נשלחה",
};

// Same family → varieties grouping as the live editor (see
// order-lines-editor.tsx), built from the historical line shape instead of
// the live RPC's — there's no catalog row to group here, just this order's
// own already-submitted lines.
function groupHistoricalLines(lines: HistoricalLineRow[]): OrderFamilyRow[] {
  const groups = new Map<string, OrderFamilyRow>();
  for (const line of lines) {
    const familyId = line.product_varieties?.family_id ?? "";
    let group = groups.get(familyId);
    if (!group) {
      group = {
        familyId,
        familyName: line.product_varieties?.product_families?.name ?? "",
        imageUrl: line.product_varieties?.product_families?.image_url ?? null,
        varieties: [],
      };
      groups.set(familyId, group);
    }
    group.varieties.push({
      varietyId: line.id,
      varietyName: line.product_varieties?.name ?? "",
      priceLabel: null,
      packType: line.product_varieties?.pack_type ?? null,
      pallets: String(line.pallets_ordered),
      comment: line.comment ?? "",
    });
  }
  return [...groups.values()].sort((a, b) => a.familyName.localeCompare(b.familyName, "he"));
}

// Read-only: the trading day is closed, so submit_order would reject any
// edit anyway (see 0018_customer-order-functions.sql's P0007). No price is
// shown — daily_order_products never captured a per-line price snapshot,
// so there's nothing historical to show even though the live editor has it.
function ClosedOrderView({ order }: { order: SpecificOrder }) {
  const supabase = createClient();

  const linesQuery = useQuery({
    queryKey: ["customer", "order-lines-readonly", order.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_order_products")
        .select(
          "id, pallets_ordered, comment, product_varieties(name, family_id, pack_type, product_families(name, image_url))",
        )
        .eq("daily_order_id", order.id)
        .order("product_variety_id");
      if (error) throw error;
      return data as unknown as HistoricalLineRow[];
    },
  });

  const families = groupHistoricalLines(linesQuery.data ?? []);

  const tradeDate = order.trading_days!.trade_date;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`הזמנה — ${new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(tradeDate))}`}
        subtitle={`יום המסחר נסגר — תצוגה בלבד. סטטוס: ${STATUS_LABEL[order.status]}${
          order.submitted_at ? ` · נשלח ב-${new Date(order.submitted_at).toLocaleString("he-IL")}` : ""
        }`}
      />

      <div className="rounded-lg border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">הזמנת תוצרת</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1 text-xs text-ink-muted">
            <Icon name="calendar" className="h-3.5 w-3.5" />
            {weekdayDateLabel(tradeDate)}
          </span>
        </div>

        {linesQuery.isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : families.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">אין שורות בהזמנה זו.</p>
        ) : (
          <OrderProductList families={families} editable={false} />
        )}
      </div>
    </div>
  );
}
