import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { inputClassName } from "@/components/reference-data/form-field";
import { StatusPill } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";

import { PICK_STATUS_TONE, STATUS_LABEL } from "./picks";

interface DayRow {
  id: string;
  trade_date: string;
  // Reverse relation (trading_days -> daily_picks): RLS
  // (daily_picks_select_own) already scopes this to the caller's own
  // company, and the table's `unique(trading_day_id, grower_company_id)`
  // means there is at most one entry here — an array only because that's
  // how PostgREST shapes a one-to-many embed.
  daily_picks: Array<{ id: string; status: "draft" | "submitted" | "closed" }>;
}

function shortDateLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "2-digit" }).format(
    new Date(isoDate),
  );
}

// Read-only pick history, the grower-module counterpart of
// CustomerOrderHistoryPage — every trading day, newest first, not just the
// ones this company has a pick for. Querying FROM trading_days and
// embedding daily_picks (rather than the other way around) is what makes a
// day this grower was never bootstrapped for (inactive at the time, or an
// empty in-season product list — see daily-pick-bootstrap.md's documented
// "known footgun") show up as an empty "לא נוצר ליקוט" row instead of
// vanishing outright, same fix as CustomerOrderHistoryPage. trading_days
// itself has no per-company scoping (RLS: trading_days_select_authenticated,
// `using (true)`) — cross-company isolation only matters for the embedded
// daily_picks, which RLS (daily_picks_select_own) still scopes to this
// company same as before. Clicking a row with a pick navigates to
// /grower/picks, which renders that pick's content — see picks.tsx's own
// `?pickId=` handling for why a historical pick needs no separate
// read-only view the way a historical order does: a pick's own `status`
// already reaches "closed" on its own (an order's never does), so
// PickLinesEditor already renders it locked without an extra flag. A row
// with no pick navigates via `tradingDayId` instead, straight to an
// empty-state view.
export default function GrowerPickHistoryPage() {
  const supabase = createClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const daysQuery = useQuery({
    queryKey: ["grower", "pick-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("id, trade_date, daily_picks(id, status)")
        .order("trade_date", { ascending: false });
      if (error) throw error;
      return data as unknown as DayRow[];
    },
  });

  const sortedDays = useMemo(() => daysQuery.data ?? [], [daysQuery.data]);

  // Filters by the visible date label — the only field a row shows, so it's
  // the only thing worth searching (matches CustomerOrderHistoryPage's own
  // search).
  const visibleDays = useMemo(() => {
    const query = search.trim();
    if (!query) return sortedDays;
    return sortedDays.filter((row) => shortDateLabel(row.trade_date).includes(query));
  }, [sortedDays, search]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="היסטוריית ליקוט" subtitle="ליקוטים מימי מסחר קודמים, מהחדש לישן." />

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
          aria-label="חיפוש בהיסטוריית הליקוט"
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
          // Not "you have no picks yet" — that sentence would tell a grower
          // their entire pick history had vanished.
          <QueryError
            what="היסטוריית הליקוט"
            onRetry={() => void daysQuery.refetch()}
            retrying={daysQuery.isFetching}
          />
        ) : sortedDays.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">אין עדיין ימי מסחר.</p>
        ) : visibleDays.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">לא נמצאו ליקוטים התואמים לחיפוש.</p>
        ) : (
          <ul>
            {visibleDays.map((row) => {
              const pick = row.daily_picks[0];
              const href = pick ? `/grower/picks?pickId=${pick.id}` : `/grower/picks?tradingDayId=${row.id}`;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => navigate(href)}
                    className="flex w-full items-center justify-between border-b border-border px-4 py-2.5 text-start text-sm transition-colors last:border-b-0 hover:bg-canvas"
                  >
                    {pick ? (
                      <StatusPill tone={PICK_STATUS_TONE[pick.status]} dot>
                        {STATUS_LABEL[pick.status]}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="neutral" dot>
                        לא נוצר ליקוט
                      </StatusPill>
                    )}
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
