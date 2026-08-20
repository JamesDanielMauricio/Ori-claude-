"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { createClient } from "@/lib/supabase/client";

interface AlertRow {
  id: string;
  read: boolean;
  display_record_id: string | null;
  number_for_display: number | null;
  full_name_for_display: string | null;
  created_at: string;
  alert_types: {
    main_text: string;
    second_line_of_text: string | null;
    app_screen: string;
    url_parameter: string | null;
  } | null;
}

// The in-app half of the notification pipeline: RLS (packages/db/migrations/0023)
// already restricts every row this query can ever see to the signed-in
// user's own alerts, so there's no client-side filter to forget here —
// the same "the database enforces it, not a query someone could write
// wrong" property every other cross-tenant boundary in this app has.
// Mounted once per role shell (BackofficeNav, RoleShell) so it's visible
// regardless of which screen is open.
export function AlertsBell() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const alertsQuery = useQuery({
    queryKey: ["alerts", "own"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select(
          "id, read, display_record_id, number_for_display, full_name_for_display, created_at, alert_types(main_text, second_line_of_text, app_screen, url_parameter)",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as AlertRow[];
    },
    // Alerts are typically created by a backoffice action (e.g. Close
    // Arrangement) the signed-in user isn't the one triggering — poll
    // rather than relying purely on an action in this same tab to
    // invalidate the query.
    refetchInterval: 60000,
  });

  const unreadCount = alertsQuery.data?.filter((alert) => !alert.read).length ?? 0;

  async function handleSelect(alert: AlertRow) {
    if (!alert.read) {
      const { error } = await supabase.from("alerts").update({ read: true }).eq("id", alert.id);
      if (!error) {
        void queryClient.invalidateQueries({ queryKey: ["alerts", "own"] });
      }
    }
    setOpen(false);
    if (alert.alert_types) {
      const { app_screen, url_parameter } = alert.alert_types;
      const target =
        url_parameter && alert.display_record_id
          ? `${app_screen}?${url_parameter}=${encodeURIComponent(alert.display_record_id)}`
          : app_screen;
      router.push(target);
    }
  }

  async function handleMarkAllRead() {
    const unreadIds = (alertsQuery.data ?? [])
      .filter((alert) => !alert.read)
      .map((alert) => alert.id);
    if (unreadIds.length === 0) return;
    const { error } = await supabase.from("alerts").update({ read: true }).in("id", unreadIds);
    if (!error) {
      void queryClient.invalidateQueries({ queryKey: ["alerts", "own"] });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="התראות"
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
      >
        <Icon name="bell" />
        {unreadCount > 0 && (
          <span className="absolute end-0.5 top-0.5 flex h-4 min-w-4 ring-2 ring-surface items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="התראות">
        <div className="flex flex-col gap-3">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="self-end rounded px-1.5 py-0.5 text-xs font-medium text-accent transition-colors hover:bg-accent-soft"
            >
              סמן הכל כנקרא
            </button>
          )}
          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {(alertsQuery.data ?? []).length === 0 && (
              <li className="px-2 py-4 text-center text-sm text-ink-muted">אין התראות.</li>
            )}
            {(alertsQuery.data ?? []).map((alert) => (
              <li key={alert.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(alert)}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-start text-sm transition-colors hover:bg-canvas ${
                    alert.read
                      ? "border-transparent text-ink-muted"
                      : "border-accent-soft bg-accent-soft/60 font-medium text-ink"
                  }`}
                >
                  <span>
                    {alert.alert_types?.main_text}
                    {alert.full_name_for_display ? ` — ${alert.full_name_for_display}` : ""}
                    {alert.number_for_display != null ? ` (${alert.number_for_display})` : ""}
                  </span>
                  {alert.alert_types?.second_line_of_text && (
                    <span className="text-xs text-ink-muted">
                      {alert.alert_types.second_line_of_text}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </>
  );
}
