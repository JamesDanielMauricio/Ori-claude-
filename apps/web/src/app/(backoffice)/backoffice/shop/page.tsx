"use client";

import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";

type Phase = "initiated" | "shop_open" | "shop_closed" | "closed";

interface OpenDay {
  id: string;
  trade_date: string;
  phase: Phase;
}

// Read-only status view for today's trading day. The lifecycle controls
// that used to live here (initiate / open shop / close shop / close
// business day / update growers) moved to BusinessDayPanel in the
// sidebar (mounted in BackofficeNav) so they're reachable from every
// backoffice screen, matching the source app, and so there is exactly
// one write surface per transition (R5) instead of two.
const PHASE_LABEL: Record<Phase | "none", string> = {
  none: "אין יום מסחר פתוח",
  initiated: "יום עסקים נפתח — החנות עדיין סגורה",
  shop_open: "החנות פתוחה להזמנות",
  shop_closed: "החנות סגורה — נותר לסגור את הסידור",
  closed: "היום נסגר",
};

export default function ShopManagementPage() {
  const supabase = createClient();

  const openDayQuery = useQuery({
    queryKey: ["shop-panel", "open-trading-day"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("id, trade_date, phase")
        .neq("phase", "closed")
        .maybeSingle();
      if (error) throw error;
      return data as OpenDay | null;
    },
  });
  const day = openDayQuery.data ?? null;

  const metricsQuery = useQuery({
    queryKey: ["shop-panel", "metrics", day?.id],
    enabled: !!day,
    queryFn: async () => {
      const [picks, orders] = await Promise.all([
        supabase.from("daily_picks").select("status").eq("trading_day_id", day!.id),
        supabase.from("daily_orders").select("status").eq("trading_day_id", day!.id),
      ]);
      if (picks.error) throw picks.error;
      if (orders.error) throw orders.error;
      return {
        picksTotal: picks.data.length,
        picksSubmitted: picks.data.filter((row) => row.status !== "draft").length,
        ordersTotal: orders.data.length,
        ordersSubmitted: orders.data.filter((row) => row.status === "submitted").length,
      };
    },
  });

  const settingsQuery = useQuery({
    queryKey: ["shop-panel", "notification-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_settings")
        .select("whatsapp_enabled, close_arrangement_whatsapp_enabled")
        .single();
      if (error) throw error;
      return data;
    },
  });

  const tradeDateLabel = day
    ? new Intl.DateTimeFormat("he-IL", { dateStyle: "full" }).format(new Date(day.trade_date))
    : null;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="ניהול חנות"
        subtitle="מחזור יום המסחר: פתיחת יום ← פתיחת חנות ← סגירת חנות ← סגירת יום עסקים. הפעולות עצמן נמצאות בסרגל הצד."
      />

      {openDayQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <section className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-ink-muted">{tradeDateLabel ?? "מוכן ליום חדש"}</p>
              <p className="mt-1 text-lg font-semibold">{PHASE_LABEL[day?.phase ?? "none"]}</p>
            </div>
            <PhaseStepper phase={day?.phase ?? "none"} />
          </div>
        </section>
      )}

      {day && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="ליקוטים שנשלחו"
            value={metricsQuery.data ? `${metricsQuery.data.picksSubmitted}/${metricsQuery.data.picksTotal}` : null}
          />
          <MetricCard
            label="הזמנות שנשלחו"
            value={metricsQuery.data ? `${metricsQuery.data.ordersSubmitted}/${metricsQuery.data.ordersTotal}` : null}
          />
          <MetricCard
            label="הודעות WhatsApp"
            value={settingsQuery.data ? (settingsQuery.data.whatsapp_enabled ? "פעיל" : "כבוי") : null}
          />
          <MetricCard
            label="WhatsApp בסגירת סידור"
            value={
              settingsQuery.data ? (settingsQuery.data.close_arrangement_whatsapp_enabled ? "פעיל" : "כבוי") : null
            }
          />
        </section>
      )}
    </div>
  );
}

// The four-phase progress strip — pure display, driven by the day's real
// phase column.
function PhaseStepper({ phase }: { phase: Phase | "none" }) {
  const steps: Array<{ key: Phase; label: string }> = [
    { key: "initiated", label: "פתיחת יום" },
    { key: "shop_open", label: "חנות פתוחה" },
    { key: "shop_closed", label: "חנות סגורה" },
    { key: "closed", label: "סידור נסגר" },
  ];
  const order: Record<Phase | "none", number> = {
    none: -1,
    initiated: 0,
    shop_open: 1,
    shop_closed: 2,
    closed: 3,
  };
  const current = order[phase];

  return (
    <ol className="flex items-center gap-1.5" aria-label="שלבי יום המסחר">
      {steps.map((step, index) => (
        <li key={step.key} className="flex items-center gap-1.5">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              index <= current ? "bg-accent-soft text-accent" : "bg-canvas text-ink-muted"
            }`}
          >
            {step.label}
          </span>
          {index < steps.length - 1 && <span className="text-xs text-ink-muted">‹</span>}
        </li>
      ))}
    </ol>
  );
}

function MetricCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      {value === null ? (
        <Skeleton className="mt-1 h-6 w-14" />
      ) : (
        <p className="mt-1 text-lg font-semibold" dir="ltr">
          {value}
        </p>
      )}
    </div>
  );
}
