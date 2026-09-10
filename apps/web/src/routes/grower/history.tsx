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

interface PickRow {
  id: string;
  status: "draft" | "submitted" | "closed";
  trading_days: { trade_date: string } | null;
}

function shortDateLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "2-digit" }).format(
    new Date(isoDate),
  );
}

// Read-only pick history, the grower-module counterpart of
// CustomerOrderHistoryPage — every past Daily Pick for this grower's
// company, newest first. Cross-company isolation is RLS
// (daily_picks_select_own), not a client-side filter. Clicking a row
// navigates to /grower/picks, which renders that pick's content — see
// picks.tsx's own `?pickId=` handling for why a historical pick needs no
// separate read-only view the way a historical order does: a pick's own
// `status` already reaches "closed" on its own (an order's never does), so
// PickLinesEditor already renders it locked without an extra flag.
export default function GrowerPickHistoryPage() {
  const supabase = createClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const picksQuery = useQuery({
    queryKey: ["grower", "pick-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_picks")
        .select("id, status, trading_days(trade_date)");
      if (error) throw error;
      return data as unknown as PickRow[];
    },
  });

  const sortedPicks = useMemo(() => {
    return [...(picksQuery.data ?? [])].sort((a, b) => {
      const dateA = a.trading_days?.trade_date ?? "";
      const dateB = b.trading_days?.trade_date ?? "";
      return dateB.localeCompare(dateA);
    });
  }, [picksQuery.data]);

  // Filters by the visible date label — the only field a row shows, so it's
  // the only thing worth searching (matches CustomerOrderHistoryPage's own
  // search).
  const visiblePicks = useMemo(() => {
    const query = search.trim();
    if (!query) return sortedPicks;
    return sortedPicks.filter((row) => {
      const label = row.trading_days ? shortDateLabel(row.trading_days.trade_date) : "";
      return label.includes(query);
    });
  }, [sortedPicks, search]);

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
        {picksQuery.isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : picksQuery.isError ? (
          // Not "you have no picks yet" — that sentence would tell a grower
          // their entire pick history had vanished.
          <QueryError
            what="היסטוריית הליקוט"
            onRetry={() => void picksQuery.refetch()}
            retrying={picksQuery.isFetching}
          />
        ) : sortedPicks.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">אין עדיין ליקוטים.</p>
        ) : visiblePicks.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">לא נמצאו ליקוטים התואמים לחיפוש.</p>
        ) : (
          <ul>
            {visiblePicks.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/grower/picks?pickId=${row.id}`)}
                  className="flex w-full items-center justify-between border-b border-border px-4 py-2.5 text-start text-sm transition-colors last:border-b-0 hover:bg-canvas"
                >
                  <StatusPill tone={PICK_STATUS_TONE[row.status]} dot>
                    {STATUS_LABEL[row.status]}
                  </StatusPill>
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    <Icon name="calendar" className="h-4 w-4" />
                    {row.trading_days ? shortDateLabel(row.trading_days.trade_date) : "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
