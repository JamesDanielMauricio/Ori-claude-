import { submitPickInputSchema, toSubmitPickRpcArgs } from "@ori/domain/lifecycle-engine";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { PickLinesEditor } from "@/components/grower/pick-lines-editor";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusTone } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
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

const STATUS_LABEL: Record<DailyPickSummary["status"], string> = {
  draft: "טיוטה",
  submitted: "נשלח",
  closed: "סגור",
};

// Draft is the only state that still needs something from the grower, so it
// is the one that gets an attention color; submitted is a success, closed is
// simply over.
const PICK_STATUS_TONE: Record<DailyPickSummary["status"], StatusTone> = {
  draft: "warning",
  submitted: "accent",
  closed: "neutral",
};

// Grower-facing daily picking input (PRD: manage-today-s-daily-pick.md).
// The bootstrap that creates this pick and its lines runs entirely on the
// server (initiate_business_day → bootstrap_grower_pick) — this screen
// only ever reads "the pick that already exists for today" and edits its
// lines; it never creates picks or lines itself.
export default function GrowerDailyPicksPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

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

  const submitMutation = useMutation({
    mutationFn: async () => {
      const input = submitPickInputSchema.parse({ dailyPickId: pickQuery.data!.id });
      const { data, error } = await supabase.rpc("submit_pick", toSubmitPickRpcArgs(input));
      if (error) throw error;
      return data as DailyPickSummary;
    },
    onSuccess: () => {
      showToast("הליקוט נשלח.", "success");
      void queryClient.invalidateQueries({ queryKey: ["grower", "daily-pick", openDayId, companyId] });
    },
    onError: (error: { message?: string }) => {
      showToast(`השליחה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
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

  const pick = pickQuery.data;

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
