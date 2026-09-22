import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { weekdayDateLabel } from "@/components/customer/catalog-grouping";
import { OrderLinesEditor } from "@/components/customer/order-lines-editor";
import { OrderProductList, type OrderFamilyRow } from "@/components/customer/order-product-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { useOpenTradingDay, type TradingDayPhase } from "@/lib/trading-day-view";

// Customer-facing catalog browsing + order placement (PRD:
// place-edit-today-s-order.md, order-form.md). The actual catalog/draft/
// submit logic lives in OrderLinesEditor, shared with the distributor's
// Customer Order Status oversight screen (/backoffice/distributor-customer)
// — see that component's header comment.
//
// An `?orderId=` search param (set by history.tsx's row links) shows a
// specific past order's content here instead of today's open one, under the
// same one rule both views use: editable while the shop is open, read-only
// otherwise (see isOrderEditable). `?tradingDayId=` is history.tsx's other
// link shape — a trading day this company has no daily_orders row for at
// all (see history.tsx's header comment for why that happens), so there is
// no order to look up by id; NoOrderView just confirms nothing was ordered.
export default function CustomerOrderPage() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("orderId");
  const tradingDayId = searchParams.get("tradingDayId");

  if (orderId) {
    return <SpecificOrderView orderId={orderId} />;
  }
  if (tradingDayId) {
    return <NoOrderView tradingDayId={tradingDayId} />;
  }
  return <TodayOrderView />;
}

// The one rule that decides whether a customer may change an order: the
// trading day's shop is open, or it isn't. There is deliberately no second,
// per-session "ערוך" gate on top of it — see OrderLinesEditor's `readOnly`.
//
// Deliberately stricter than submit_order, which only refuses once the day
// reaches phase 'closed' (P0007, packages/db/migrations/0042_customer-order-
// cap.sql). The two phases in between are ones the server would still accept
// a write in, but the business doesn't:
//
//   initiated   — the day exists but open_shop hasn't run yet, so this
//                 customer has no daily_orders header for it at all and a
//                 save would fail with P0002 regardless. Nothing to edit.
//   shop_closed — ordering is over. close_shop's own contract says it
//                 ("customers can no longer order; growers may still edit
//                 picks" — 0011_lifecycle-functions.sql), and the
//                 distributor is by then building the day's arrangement out
//                 of exactly these numbers, so a customer moving them
//                 underneath is the thing closing the shop exists to stop.
//
// This being stricter than the database is fine in this direction, and only
// this direction: it's a UI declining to offer a write, not a security
// boundary. Anything that genuinely must not happen — another company's
// order, a closed day, a quantity over the customer's cap — is still refused
// by the RPC itself, which is the only place a refusal counts.
function isOrderEditable(phase: TradingDayPhase): boolean {
  return phase === "shop_open";
}

// Says which of those states the reader is in, since the screen otherwise
// changes only by NOT having a save button — an absence is a poor way to
// learn that the shop closed twenty minutes ago.
const PHASE_SUBTITLE: Record<TradingDayPhase, string> = {
  initiated: "יום המסחר נפתח אך החנות עדיין סגורה — ניתן יהיה להזמין עם פתיחתה.",
  shop_open: "עדכן כמויות ולחץ שמירה — ההזמנה נשלחת רק לאחר אישור הסיכום.",
  shop_closed: "החנות נסגרה להזמנות — תצוגה בלבד.",
  // Unreachable from either view below (both hand a closed day to
  // ClosedOrderView, which writes its own richer subtitle including the
  // submission timestamp) — present so this map stays exhaustive over the
  // enum rather than needing a fallback branch at each use.
  closed: "יום המסחר הסתיים — תצוגה בלבד.",
};

function TodayOrderView() {
  // The shared "live open trading day" query (lib/trading-day-view.tsx),
  // not a private copy of it: it selects `phase`, which this screen now
  // needs, and it already polls + subscribes to trading_days over realtime.
  // That last part is what keeps the rule honest — when the distributor
  // closes the shop, this page drops to read-only within seconds instead of
  // staying editable until the customer happens to reload.
  const openDayQuery = useOpenTradingDay();
  const day = openDayQuery.data ?? null;

  const tradeDateLabel = useMemo(() => {
    if (!day) return "";
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(day.trade_date));
  }, [day]);

  if (openDayQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // "There is no open trading day right now" is a claim about the business,
  // and a failed request cannot support it — a customer who reads that when
  // the shop is in fact open simply doesn't order.
  if (openDayQuery.isError) {
    return (
      <QueryError
        what="יום המסחר"
        onRetry={() => void openDayQuery.refetch()}
        retrying={openDayQuery.isFetching}
      />
    );
  }

  if (!day) {
    return <p className="text-sm text-ink-muted">אין יום מסחר פתוח כרגע.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <PageHeader title={`הזמנה — ${tradeDateLabel}`} subtitle={PHASE_SUBTITLE[day.phase]} />
      <OrderLinesEditor
        tradingDayId={day.id}
        tradeDate={day.trade_date}
        readOnly={!isOrderEditable(day.phase)}
      />
    </div>
  );
}

interface SpecificOrder {
  id: string;
  status: "open" | "submitted";
  submitted_at: string | null;
  trading_day_id: string;
  trading_days: { trade_date: string; phase: TradingDayPhase } | null;
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

  // A failed request is not a missing order. Keeping these apart also keeps
  // the "not found" message below honest: it deliberately does not distinguish
  // "doesn't exist" from "not yours", and folding transport failures into it
  // too would make it mean nothing at all.
  if (orderQuery.isError) {
    return (
      <QueryError
        what="ההזמנה"
        onRetry={() => void orderQuery.refetch()}
        retrying={orderQuery.isFetching}
      />
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

  // Trading day not closed yet: reuse the exact same editor the default (no
  // orderId) view renders, under the same isOrderEditable rule — an order
  // reached from the history list is not a different kind of object, so it
  // must not obey a different rule about when it can be changed. Note that
  // "already submitted" is not one of those rules: submit_order allows
  // re-submitting while the shop is open, so a sent order stays editable
  // here too, not just a new draft.
  //
  // The single-open-day index (trading_days_single_open_idx) means a
  // non-closed day IS the current day, so no extra "is this today's day?"
  // check is needed on top of the phase.
  if (order.trading_days.phase !== "closed") {
    const { phase, trade_date } = order.trading_days;
    return (
      <div className="flex flex-col gap-2">
        <PageHeader
          title={`הזמנה — ${new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(trade_date))}`}
          subtitle={PHASE_SUBTITLE[phase]}
        />
        <OrderLinesEditor
          tradingDayId={order.trading_day_id}
          tradeDate={trade_date}
          readOnly={!isOrderEditable(phase)}
        />
      </div>
    );
  }

  return <ClosedOrderView order={order} />;
}

interface EmptyTradingDay {
  trade_date: string;
  phase: TradingDayPhase;
}

// Reached from a history row for a trading day this company has no
// daily_orders row for (see CustomerOrderPage's comment on `tradingDayId`).
// There's no order id to fetch lines by, so this only needs the day's own
// date/phase — read via `trading_days_select_authenticated` (`using
// (true)`), not company-scoped, which is fine: a trade date and phase carry
// nothing another company couldn't already infer from the open-shop flow.
function NoOrderView({ tradingDayId }: { tradingDayId: string }) {
  const supabase = createClient();

  const dayQuery = useQuery({
    queryKey: ["customer", "trading-day-by-id", tradingDayId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("trade_date, phase")
        .eq("id", tradingDayId)
        .maybeSingle();
      if (error) throw error;
      return data as EmptyTradingDay | null;
    },
  });

  if (dayQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (dayQuery.isError) {
    return (
      <QueryError what="יום המסחר" onRetry={() => void dayQuery.refetch()} retrying={dayQuery.isFetching} />
    );
  }

  const day = dayQuery.data;
  if (!day) {
    return <p className="text-sm text-ink-muted">יום המסחר לא נמצא.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title={`הזמנה — ${new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(day.trade_date))}`}
      />
      <div className="rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
        <EmptyState
          icon="calendar"
          title="לא הוזמן ביום מסחר זה"
          hint={
            day.phase === "closed" || day.phase === "shop_closed"
              ? "לא נמצאה הזמנה של החברה שלך עבור יום המסחר הזה."
              : "טרם נוצרה הזמנה עבור החברה שלך ביום המסחר הזה. אם החנות פתוחה ואתם מצפים להזמין, פנו למפיץ."
          }
        />
      </div>
    </div>
  );
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

      <div className="overflow-hidden rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted/60 px-5 py-4">
          <h2 className="text-sm font-semibold">הזמנת תוצרת</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted ring-1 ring-inset ring-border-strong">
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
