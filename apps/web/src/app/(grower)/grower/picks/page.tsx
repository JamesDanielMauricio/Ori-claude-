"use client";

import { submitPickInputSchema, toSubmitPickRpcArgs } from "@ori/domain/lifecycle-engine";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { PickLinesEditor } from "@/components/grower/pick-lines-editor";
import { Button } from "@/components/ui/button";
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
    return <p className="text-sm text-ink-muted">אין יום מסחר פתוח כרגע.</p>;
  }

  if (!pickQuery.data) {
    return <p className="text-sm text-ink-muted">אין עדיין ליקוט עבורך היום — פנה למפיץ.</p>;
  }

  const pick = pickQuery.data;

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title={`עדכון יומי — ${tradeDateLabel}`}
        subtitle={`סטטוס: ${STATUS_LABEL[pick.status]}${pick.submitted_at ? ` · נשלח ב-${new Date(pick.submitted_at).toLocaleString("he-IL")}` : ""}`}
        actions={
          pick.status === "draft" ? (
            <Button type="button" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
              {submitMutation.isPending ? "שולח…" : "שלח ליקוט"}
            </Button>
          ) : undefined
        }
      />

      <PickLinesEditor dailyPickId={pick.id} pickStatus={pick.status} />
    </div>
  );
}
