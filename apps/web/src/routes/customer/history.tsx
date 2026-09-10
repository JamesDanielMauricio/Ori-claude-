import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { inputClassName } from "@/components/reference-data/form-field";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";

interface OrderRow {
  id: string;
  status: "open" | "submitted";
  submitted_at: string | null;
  trading_days: { trade_date: string; phase: "initiated" | "shop_open" | "shop_closed" | "closed" } | null;
}

// The list badge collapses order status + trading-day phase into one of
// three states a customer actually cares about: still editable, sent but
// the day is wrapping up, or fully closed history. `daily_orders.status`
// alone only knows "open"/"submitted" — "closed" comes from the trading
// day itself (see order.tsx's `.neq("phase", "closed")` for the same
// "closed = finished trading day" convention).
type BadgeKind = "new" | "sent" | "closed";

function badgeFor(row: OrderRow): BadgeKind {
  if (row.trading_days?.phase === "closed") return "closed";
  if (row.status === "submitted") return "sent";
  return "new";
}

const BADGE_LABEL: Record<BadgeKind, string> = {
  new: "חדש",
  sent: "נשלח",
  closed: "נסגר",
};

const BADGE_CLASSES: Record<BadgeKind, string> = {
  new: "border-warning text-warning font-semibold",
  sent: "border-accent text-accent font-semibold",
  closed: "border-border-strong text-ink-subtle font-medium",
};

function shortDateLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "2-digit" }).format(
    new Date(isoDate),
  );
}

// Read-only order history (PRD: customer-home/order-history.md) — every
// past Daily Order for this customer's company, newest first. Cross-company
// isolation is enforced by RLS (daily_orders_select_own), not a
// client-side filter. Clicking a row navigates to /customer/order, which
// renders that order's content — live/editable when its trading day isn't
// closed yet, read-only otherwise (see order.tsx's `orderId` search param).
export default function CustomerOrderHistoryPage() {
  const supabase = createClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const ordersQuery = useQuery({
    queryKey: ["customer", "order-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_orders")
        .select("id, status, submitted_at, trading_days(trade_date, phase)");
      if (error) throw error;
      return data as unknown as OrderRow[];
    },
  });

  const sortedOrders = useMemo(() => {
    return [...(ordersQuery.data ?? [])].sort((a, b) => {
      const dateA = a.trading_days?.trade_date ?? "";
      const dateB = b.trading_days?.trade_date ?? "";
      return dateB.localeCompare(dateA);
    });
  }, [ordersQuery.data]);

  // Filters by the visible date label — the only field a row shows, so it's
  // the only thing worth searching (matches the mockup's plain "חיפוש" box).
  const visibleOrders = useMemo(() => {
    const query = search.trim();
    if (!query) return sortedOrders;
    return sortedOrders.filter((row) => {
      const label = row.trading_days ? shortDateLabel(row.trading_days.trade_date) : "";
      return label.includes(query);
    });
  }, [sortedOrders, search]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="היסטוריית הזמנות" subtitle="הזמנות מימי מסחר קודמים, מהחדשה לישנה." />

      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-ink-subtle"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="חיפוש"
          aria-label="חיפוש בהיסטוריית ההזמנות"
          className={`${inputClassName} w-full ps-9`}
        />
      </div>

      <div className="rounded-lg border border-border bg-surface shadow-card">
        {ordersQuery.isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : ordersQuery.isError ? (
          // Not "you have no orders yet" — that sentence would tell a customer
          // their entire order history had vanished.
          <QueryError
            what="היסטוריית ההזמנות"
            onRetry={() => void ordersQuery.refetch()}
            retrying={ordersQuery.isFetching}
          />
        ) : sortedOrders.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">אין עדיין הזמנות.</p>
        ) : visibleOrders.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">לא נמצאו הזמנות התואמות לחיפוש.</p>
        ) : (
          <ul>
            {visibleOrders.map((row) => {
              const badge = badgeFor(row);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/customer/order?orderId=${row.id}`)}
                    className="flex w-full items-center justify-between border-b border-border px-4 py-2.5 text-start text-sm transition-colors last:border-b-0 hover:bg-canvas"
                  >
                    <span
                      className={`inline-flex min-w-[4.5rem] items-center justify-center rounded-full border px-3 py-1 text-xs ${BADGE_CLASSES[badge]}`}
                    >
                      {BADGE_LABEL[badge]}
                    </span>
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <Icon name="calendar" className="h-4 w-4" />
                      {row.trading_days ? shortDateLabel(row.trading_days.trade_date) : "—"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
