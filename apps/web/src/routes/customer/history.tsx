import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { inputClassName } from "@/components/reference-data/form-field";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";

type TradingDayPhase = "initiated" | "shop_open" | "shop_closed" | "closed";

interface DayRow {
  id: string;
  trade_date: string;
  phase: TradingDayPhase;
  // Reverse relation (trading_days -> daily_orders): RLS
  // (daily_orders_select_own) already scopes this to the caller's own
  // company, and the table's `unique(trading_day_id, customer_company_id)`
  // means there is at most one entry here — an array only because that's
  // how PostgREST shapes a one-to-many embed.
  daily_orders: Array<{ id: string; status: "open" | "submitted"; submitted_at: string | null }>;
}

// The list badge collapses order status + trading-day phase into one of
// four states a customer actually cares about: no order was ever placed
// for that day, still editable, sent but the day is wrapping up, or fully
// closed history. `daily_orders.status` alone only knows "open"/
// "submitted" — "closed" comes from the trading day itself (see
// order.tsx's `.neq("phase", "closed")` for the same "closed = finished
// trading day" convention).
type BadgeKind = "none" | "new" | "sent" | "closed";

function badgeFor(row: DayRow): BadgeKind {
  const order = row.daily_orders[0];
  if (!order) return "none";
  if (row.phase === "closed") return "closed";
  if (order.status === "submitted") return "sent";
  return "new";
}

const BADGE_LABEL: Record<BadgeKind, string> = {
  none: "לא הוזמן",
  new: "חדש",
  sent: "נשלח",
  closed: "נסגר",
};

const BADGE_CLASSES: Record<BadgeKind, string> = {
  none: "border-border-strong text-ink-subtle font-medium",
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
// trading day, newest first, not just the ones this company has an order
// for. Querying FROM trading_days and embedding daily_orders (rather than
// the other way around) is what makes a day with no order yet show up as
// an empty "לא הוזמן" row instead of vanishing outright — the previous
// query started from daily_orders, so any day this company's header row
// was never bootstrapped for (new company, empty in-season list at
// bootstrap time, etc. — see daily-pick-bootstrap.md's "known footgun" for
// the grower-side equivalent) silently disappeared from history rather
// than showing as a day with nothing ordered. trading_days itself has no
// per-company scoping (RLS: trading_days_select_authenticated, `using
// (true)`) — cross-company isolation only matters for the embedded
// daily_orders, which RLS (daily_orders_select_own) still scopes to this
// company same as before. Clicking a row with an order navigates to
// /customer/order, which renders that order's content — live/editable
// when its trading day isn't closed yet, read-only otherwise (see
// order.tsx's `orderId` search param). A row with no order navigates via
// `tradingDayId` instead, straight to an empty-state view.
export default function CustomerOrderHistoryPage() {
  const supabase = createClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const daysQuery = useQuery({
    queryKey: ["customer", "order-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("id, trade_date, phase, daily_orders(id, status, submitted_at)")
        .order("trade_date", { ascending: false });
      if (error) throw error;
      return data as unknown as DayRow[];
    },
  });

  const sortedDays = useMemo(() => daysQuery.data ?? [], [daysQuery.data]);

  // Filters by the visible date label — the only field a row shows, so it's
  // the only thing worth searching (matches the mockup's plain "חיפוש" box).
  const visibleDays = useMemo(() => {
    const query = search.trim();
    if (!query) return sortedDays;
    return sortedDays.filter((row) => shortDateLabel(row.trade_date).includes(query));
  }, [sortedDays, search]);

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
        {daysQuery.isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : daysQuery.isError ? (
          // Not "you have no orders yet" — that sentence would tell a customer
          // their entire order history had vanished.
          <QueryError
            what="היסטוריית ההזמנות"
            onRetry={() => void daysQuery.refetch()}
            retrying={daysQuery.isFetching}
          />
        ) : sortedDays.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">אין עדיין ימי מסחר.</p>
        ) : visibleDays.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">לא נמצאו הזמנות התואמות לחיפוש.</p>
        ) : (
          <ul>
            {visibleDays.map((row) => {
              const badge = badgeFor(row);
              const order = row.daily_orders[0];
              const href = order ? `/customer/order?orderId=${order.id}` : `/customer/order?tradingDayId=${row.id}`;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => navigate(href)}
                    className="flex w-full items-center justify-between border-b border-border px-4 py-2.5 text-start text-sm transition-colors last:border-b-0 hover:bg-canvas"
                  >
                    <span
                      className={`inline-flex min-w-[4.5rem] items-center justify-center rounded-full border px-3 py-1 text-xs ${BADGE_CLASSES[badge]}`}
                    >
                      {BADGE_LABEL[badge]}
                    </span>
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <Icon name="calendar" className="h-4 w-4" />
                      {shortDateLabel(row.trade_date)}
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
