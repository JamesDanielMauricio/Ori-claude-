import { submitPickInputSchema, toSubmitPickRpcArgs } from "@ori/domain/lifecycle-engine";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { PickLinesEditor } from "@/components/grower/pick-lines-editor";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusTone } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";

interface OpenTradingDay {
  id: string;
  trade_date: string;
}

interface DailyPickSummary {
  id: string;
  status: "draft" | "submitted" | "closed";
  submitted_at: string | null;
}

// Exported for history.tsx: both screens show the same `daily_picks.status`
// enum and must agree on what it's called and colored, so it's one lookup
// shared between them rather than two that could drift.
export const STATUS_LABEL: Record<DailyPickSummary["status"], string> = {
  draft: "טיוטה",
  submitted: "נשלח",
  closed: "סגור",
};

// Draft is the only state that still needs something from the grower, so it
// is the one that gets an attention color; submitted is a success, closed is
// simply over.
export const PICK_STATUS_TONE: Record<DailyPickSummary["status"], StatusTone> = {
  draft: "warning",
  submitted: "accent",
  closed: "neutral",
};

// Grower-facing daily picking input (PRD: manage-today-s-daily-pick.md).
// The bootstrap that creates this pick and its lines runs entirely on the
// server (initiate_business_day → bootstrap_grower_pick) — this screen
// only ever reads "the pick that already exists for today" and edits its
// lines; it never creates picks or lines itself.
//
// An `?pickId=` search param (set by history.tsx's row links) shows a
// specific past pick's content here instead of today's open one. Unlike the
// customer order screen's equivalent split, a historical pick needs no
// separate read-only view: `daily_picks.status` reaches "closed" on its own
// (an order's status never does — see OrderLinesEditor's `readOnly`
// comment), so PickLinesEditor already renders a closed pick locked without
// an extra flag from here.
export default function GrowerDailyPicksPage() {
  const [searchParams] = useSearchParams();
  const pickId = searchParams.get("pickId");

  if (pickId) {
    return <SpecificPickView pickId={pickId} />;
  }
  return <TodayPickView />;
}

function TodayPickView() {
  const { profile } = useAuth();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const openDayQuery = useQuery({
    queryKey: ["grower", "open-trading-day"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("id, trade_date")
        .neq("phase", "closed")
        .maybeSingle();
      if (error) throw error;
      return data as OpenTradingDay | null;
    },
  });

  const companyId = profile?.companyId;
  const openDayId = openDayQuery.data?.id;

  const pickQuery = useQuery({
    queryKey: ["grower", "daily-pick", openDayId, companyId],
    enabled: !!openDayId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_picks")
        .select("id, status, submitted_at")
        .eq("trading_day_id", openDayId!)
        .eq("grower_company_id", companyId!)
        .maybeSingle();
      if (error) throw error;
      return data as DailyPickSummary | null;
    },
  });

  const tradeDateLabel = useMemo(() => {
    if (!openDayQuery.data) return "";
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(openDayQuery.data.trade_date));
  }, [openDayQuery.data]);

  if (openDayQuery.isLoading || (openDayId && pickQuery.isLoading)) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // A failed fetch is not evidence that there is no trading day. Telling a
  // grower "no business day is open" when the request actually errored is the
  // costliest wrong answer on this screen — it reads as "nothing to pick
  // today" and they stop.
  if (openDayQuery.isError) {
    return <QueryError what="יום המסחר" onRetry={() => void openDayQuery.refetch()} retrying={openDayQuery.isFetching} />;
  }

  if (!openDayQuery.data) {
    return (
      <div className="rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
        <EmptyState
          icon="clock"
          title="אין יום מסחר פתוח"
          hint="כשהמפיץ יפתח את יום העסקים, רשימת הליקוט שלך תופיע כאן."
        />
      </div>
    );
  }

  // Same reasoning one level down: "no pick list was created for you" is a
  // real state that tells the grower to call the distributor, so it must not
  // be shown for a request that simply failed.
  if (pickQuery.isError) {
    return <QueryError what="רשימת הליקוט" onRetry={() => void pickQuery.refetch()} retrying={pickQuery.isFetching} />;
  }

  if (!pickQuery.data) {
    return (
      <div className="rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
        <EmptyState
          icon="sprout"
          title="אין ליקוט עבורך היום"
          hint="לא נוצרה עבורך רשימת ליקוט ליום המסחר הנוכחי. פנה למפיץ כדי לבדוק את שיוך המוצרים שלך."
        />
      </div>
    );
  }

  return (
    <PickDetail
      pick={pickQuery.data}
      tradeDateLabel={tradeDateLabel}
      onSubmitted={() =>
        void queryClient.invalidateQueries({ queryKey: ["grower", "daily-pick", openDayId, companyId] })
      }
    />
  );
}

interface SpecificPick extends DailyPickSummary {
  trading_day_id: string;
  trading_days: { trade_date: string } | null;
}

function SpecificPickView({ pickId }: { pickId: string }) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const pickQuery = useQuery({
    queryKey: ["grower", "pick-by-id", pickId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_picks")
        .select("id, status, submitted_at, trading_day_id, trading_days(trade_date)")
        .eq("id", pickId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SpecificPick | null;
    },
  });

  if (pickQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (pickQuery.isError) {
    return (
      <QueryError what="הליקוט" onRetry={() => void pickQuery.refetch()} retrying={pickQuery.isFetching} />
    );
  }

  const pick = pickQuery.data;
  // Either a bad id, or RLS (daily_picks_select_own) filtered out a row that
  // isn't this grower's own — same "not found" message either way, matching
  // the customer order screen's equivalent case.
  if (!pick || !pick.trading_days) {
    return <p className="text-sm text-ink-muted">הליקוט לא נמצא.</p>;
  }

  const tradeDateLabel = new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(
    new Date(pick.trading_days.trade_date),
  );

  return (
    <PickDetail
      pick={pick}
      tradeDateLabel={tradeDateLabel}
      onSubmitted={() => void queryClient.invalidateQueries({ queryKey: ["grower", "pick-by-id", pickId] })}
    />
  );
}

// The header + status strip + editor both TodayPickView and SpecificPickView
// render — identical either way, since a pick from history is not a
// different kind of object, only a different way of finding one (same
// precedent as OrderLinesEditor being shared between the customer's own
// order screen and its history-reached view).
function PickDetail({
  pick,
  tradeDateLabel,
  onSubmitted,
}: {
  pick: DailyPickSummary;
  tradeDateLabel: string;
  onSubmitted: () => void;
}) {
  const supabase = createClient();
  const { showToast } = useToast();

  const submitMutation = useMutation({
    mutationFn: async () => {
      const input = submitPickInputSchema.parse({ dailyPickId: pick.id });
      const { data, error } = await supabase.rpc("submit_pick", toSubmitPickRpcArgs(input));
      if (error) throw error;
      return data as DailyPickSummary;
    },
    onSuccess: () => {
      showToast("הליקוט נשלח.", "success");
      onSubmitted();
    },
    onError: (error: { message?: string }) => {
      showToast(`השליחה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="עדכון יומי"
        subtitle="עדכן את הכמויות שנקטפו ושעת האיסוף לכל מוצר, ושלח את הליקוט למפיץ."
        actions={
          pick.status === "draft" ? (
            <Button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending && (
                <span
                  aria-hidden
                  className="animate-spin-loop h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {submitMutation.isPending ? "שולח…" : "שלח ליקוט"}
            </Button>
          ) : undefined
        }
      />

      {/* Status moved out of the subtitle and onto its own strip. "טיוטה" vs
          "נשלח" is the single most important fact on this screen — whether
          the grower still has work to do — and it was previously a fragment
          of a grey sentence under the title. */}
      <div className="animate-rise-in flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-5 py-4 shadow-card ring-1 ring-inset ring-border/70">
        <div className="flex items-center gap-2.5 text-sm text-ink-muted">
          <Icon name="calendar" className="h-4 w-4 shrink-0 text-ink-subtle" />
          <span>{tradeDateLabel}</span>
        </div>
        <div className="flex items-center gap-3">
          {pick.submitted_at && (
            <span className="text-xs text-ink-muted">
              נשלח ב-{new Date(pick.submitted_at).toLocaleString("he-IL")}
            </span>
          )}
          <StatusPill tone={PICK_STATUS_TONE[pick.status]} dot>
            {STATUS_LABEL[pick.status]}
          </StatusPill>
        </div>
      </div>

      <PickLinesEditor dailyPickId={pick.id} pickStatus={pick.status} />
    </div>
  );
}
