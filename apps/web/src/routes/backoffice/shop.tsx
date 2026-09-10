import { useQuery } from "@tanstack/react-query";

import { StatusPill } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { useTradingDayView, type TradingDayPhase } from "@/lib/trading-day-view";

// Read-only status view of the day shown in the sidebar's picker — the live
// trading day by default, or a specific past date once pinned there
// (lib/trading-day-view.tsx). The lifecycle controls that used to live here
// (initiate / open shop / close shop / close business day / update growers)
// are in BusinessDayPanel in the sidebar (mounted in BackofficeNav) so
// they're reachable from every backoffice screen, matching the source app,
// and so there is exactly one write surface per transition (R5) instead of
// two — and, now, so they stay tied to the live day even while this screen
// is showing a different one.
const PHASE_LABEL: Record<TradingDayPhase | "none", string> = {
  none: "אין יום מסחר פתוח",
  initiated: "יום עסקים נפתח — החנות עדיין סגורה",
  shop_open: "החנות פתוחה להזמנות",
  shop_closed: "החנות סגורה — נותר לסגור את הסידור",
  closed: "היום נסגר",
};

export default function ShopManagementPage() {
  const supabase = createClient();
  const dayView = useTradingDayView();
  const day = dayView.day;

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

  const phase = day?.phase ?? "none";

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="ניהול חנות"
        subtitle="מחזור יום המסחר: פתיחת יום ← פתיחת חנות ← סגירת חנות ← סגירת יום עסקים. הפעולות עצמן נמצאות בסרגל הצד."
        actions={
          // Only when the sidebar's picker has pinned a date away from the
          // live day (lib/trading-day-view.tsx) — this screen has nothing
          // else to distinguish "am I looking at today or last week" once a
          // pinned day happens to still show "פעיל"-shaped phase text.
          !dayView.isLive ? (
            <StatusPill tone="warning">צפייה בעבר — לא ניתן לערוך</StatusPill>
          ) : undefined
        }
      />

      {dayView.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : dayView.isError ? (
        <QueryError
          what="מצב יום המסחר"
          onRetry={() => void dayView.refetch()}
          retrying={dayView.isFetching}
        />
      ) : (
        // The day's state is the whole point of this screen, so it gets a
        // hero panel rather than a line of text in a bordered box: the date
        // as a kicker, the phase as display type, and a live dot when the
        // shop is actually taking orders.
        <section className="animate-rise-in overflow-hidden rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
          <div className="flex flex-wrap items-start justify-between gap-4 p-6">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-ink-subtle">
                {tradeDateLabel ?? (dayView.isLive ? "אין יום פעיל" : "לא נמצא יום מסחר בתאריך זה")}
              </p>
              <h2 className="font-display mt-2 text-2xl text-ink">{PHASE_LABEL[phase]}</h2>
            </div>
            {phase === "shop_open" && dayView.isLive ? (
              <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/25">
                {/* The ring pulses out from behind a static dot, so nothing
                    reflows — see globals.css's `ping-ring`. */}
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping-ring absolute inset-0 rounded-full bg-accent" />
                  <span className="relative h-2 w-2 rounded-full bg-accent" />
                </span>
                פעיל
              </span>
            ) : (
              <StatusPill
                tone={phase === "none" ? "neutral" : phase === "closed" ? "neutral" : "brass"}
              >
                {phase === "none" ? "לא פעיל" : phase === "closed" ? "הסתיים" : "בתהליך"}
              </StatusPill>
            )}
          </div>
          <div className="border-t border-border bg-surface-muted/50 px-6 py-4">
            <PhaseStepper phase={phase} />
          </div>
        </section>
      )}

      {day && (
        <div className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold tracking-[0.08em] text-ink-subtle">מצב היום</h2>
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {/* `failed` exists because these cards read "still loading" from a
                null value, and a failed query leaves the value null forever —
                so an error used to render as a skeleton that shimmered
                indefinitely, with no error, no retry, and no way to tell it
                from a slow network. */}
            <MetricCard
              label="ליקוטים שנשלחו"
              value={metricsQuery.data?.picksSubmitted ?? null}
              total={metricsQuery.data?.picksTotal ?? null}
              failed={metricsQuery.isError}
              icon="sprout"
            />
            <MetricCard
              label="הזמנות שנשלחו"
              value={metricsQuery.data?.ordersSubmitted ?? null}
              total={metricsQuery.data?.ordersTotal ?? null}
              failed={metricsQuery.isError}
              icon="briefcase"
            />
            <ToggleCard
              label="הודעות WhatsApp"
              enabled={settingsQuery.data?.whatsapp_enabled ?? null}
              failed={settingsQuery.isError}
            />
            <ToggleCard
              label="WhatsApp בסגירת סידור"
              enabled={settingsQuery.data?.close_arrangement_whatsapp_enabled ?? null}
              failed={settingsQuery.isError}
            />
          </section>
        </div>
      )}
    </div>
  );
}

// The four-phase progress strip — pure display, driven by the day's real
// phase column. Rebuilt as a numbered track rather than a row of pills: pills
// separated by a "‹" glyph didn't communicate progress, only sequence. Here
// completed steps are filled, the current one is ringed, and the connecting
// line between them fills in behind — so "where are we in the day" is
// readable without comparing tint values.
function PhaseStepper({ phase }: { phase: TradingDayPhase | "none" }) {
  const steps: Array<{ key: TradingDayPhase; label: string }> = [
    { key: "initiated", label: "פתיחת יום" },
    { key: "shop_open", label: "חנות פתוחה" },
    { key: "shop_closed", label: "חנות סגורה" },
    { key: "closed", label: "סידור נסגר" },
  ];
  const order: Record<TradingDayPhase | "none", number> = {
    none: -1,
    initiated: 0,
    shop_open: 1,
    shop_closed: 2,
    closed: 3,
  };
  const current = order[phase];

  return (
    <ol className="flex items-center" aria-label="שלבי יום המסחר">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.key} className="flex min-w-0 flex-1 items-center last:flex-none">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  done
                    ? "bg-accent text-accent-ink"
                    : active
                      ? "bg-surface text-accent ring-2 ring-accent"
                      : "bg-surface text-ink-subtle ring-1 ring-inset ring-border-strong"
                }`}
              >
                {done ? "✓" : index + 1}
              </span>
              <span
                className={`truncate text-xs ${
                  active ? "font-semibold text-accent" : done ? "text-ink" : "text-ink-subtle"
                }`}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={`mx-2 h-px min-w-4 flex-1 ${done ? "bg-accent" : "bg-border-strong"}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// A count against a total, shown as a big numeral plus a progress bar. The
// previous version printed "2/3" as one string, which is a number the eye has
// to parse; the bar answers "are we nearly there?" before it is read.
function MetricCard({
  label,
  value,
  total,
  failed,
  icon,
}: {
  label: string;
  value: number | null;
  total: number | null;
  // The query errored. Distinguished from `value === null` (still loading),
  // which it would otherwise be indistinguishable from — forever.
  failed?: boolean;
  icon: IconName;
}) {
  const loading = !failed && (value === null || total === null);
  const hasValue = value !== null && total !== null;
  const pct = hasValue && total > 0 ? Math.round((value / total) * 100) : 0;
  const complete = hasValue && total > 0 && value === total;

  return (
    <div className="animate-rise-in rounded-xl bg-surface p-5 shadow-card ring-1 ring-inset ring-border/70">
      <div className="flex items-center gap-2 text-ink-subtle">
        <Icon name={icon} className="h-4 w-4 shrink-0" />
        <p className="truncate text-xs font-medium">{label}</p>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-16" />
      ) : !hasValue ? (
        // Errored. An em dash reads as "unknown", which is the truth; a zero
        // here would be a wrong number the distributor might act on.
        <p className="mt-2.5 text-sm text-ink-subtle">— לא נטען</p>
      ) : (
        <>
          <p className="mt-2.5 flex items-baseline gap-1" dir="ltr">
            <span
              className={`font-display text-3xl leading-none ${complete ? "text-accent" : "text-ink"}`}
            >
              {value}
            </span>
            <span className="text-sm text-ink-subtle">/ {total}</span>
          </p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-muted">
            <div
              // `scaleX` on a full-width bar rather than a percentage width,
              // so the fill is a compositor transform and never triggers
              // layout when the number updates on refetch.
              className={`h-full origin-right rounded-full transition-transform duration-500 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${complete ? "bg-accent" : "bg-brass"}`}
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

// A boolean setting. Reads as on/off at a glance via a dot rather than
// requiring the words "פעיל" / "כבוי" to be read first.
function ToggleCard({
  label,
  enabled,
  failed,
}: {
  label: string;
  enabled: boolean | null;
  // See MetricCard: without this, an errored settings query renders as a
  // skeleton that never resolves.
  failed?: boolean;
}) {
  return (
    <div className="animate-rise-in rounded-xl bg-surface p-5 shadow-card ring-1 ring-inset ring-border/70">
      <div className="flex items-center gap-2 text-ink-subtle">
        <Icon name="bell" className="h-4 w-4 shrink-0" />
        <p className="truncate text-xs font-medium">{label}</p>
      </div>
      {enabled === null && failed ? (
        // Never guess "off" here: this card reports whether WhatsApp dispatch
        // is live, and showing a confident "כבוי" for a failed read would be
        // a false statement about the system's actual configuration.
        <p className="mt-3 text-sm text-ink-subtle">— לא נטען</p>
      ) : enabled === null ? (
        <Skeleton className="mt-3 h-7 w-20" />
      ) : (
        <div className="mt-3">
          <StatusPill tone={enabled ? "accent" : "neutral"} dot>
            {enabled ? "פעיל" : "כבוי"}
          </StatusPill>
        </div>
      )}
    </div>
  );
}
