import { REALTIME_CHANNEL_STATES } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";
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
  const navigate = useNavigate();
  const { user } = useAuth();
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
    // Arrangement) the signed-in user isn't the one triggering — poll as a
    // fallback for a dropped websocket, alongside the realtime push below
    // which is what normally delivers these within seconds instead of up
    // to 60s later.
    refetchInterval: 60000,
  });

  // Push-triggered refresh, same trigger-only shape as
  // order-lines-editor.tsx (the payload is never read, only used to
  // re-run this RLS-governed query). `alerts` is in the realtime
  // publication (packages/db/migrations/0041_expand-realtime-publication.sql).
  // Unlike that precedent, this filters server-side to the signed-in
  // user's own rows — alerts is a tenant-wide table every signed-in user's
  // bell would otherwise wake up for on every notification anyone gets.
  useEffect(() => {
    if (!user) return;
    const userId = user.id;

    // supabase.channel(topic) returns the SAME object for a topic already
    // registered on this client rather than a new one (RealtimeClient's own
    // doc comment: "If a channel with the same topic already exists it will
    // be returned instead of creating a duplicate connection") — and this
    // component is mounted TWICE at once by RoleShell (one copy in the
    // mobile header, one in the desktop sidebar; both always in the DOM,
    // only one visible at a time via CSS — see that file's own comment).
    // Without this guard, the second mount's effect calls `.on()` on a
    // channel the first mount already `.subscribe()`d, which throws
    // ("cannot add `postgres_changes` callbacks... after `subscribe()`") —
    // and since nothing in this app has an error boundary, that uncaught
    // effect error unmounts the entire page, not just this component.
    // Skipping the second `.on()`/`.subscribe()` is safe: only one
    // listener needs to fire, since every mount invalidates the same
    // shared queryClient key regardless of which channel object triggered
    // it.
    const channel = supabase.channel(`alerts-own-${userId}`);
    const alreadySubscribed = channel.state !== REALTIME_CHANNEL_STATES.closed;

    if (!alreadySubscribed) {
      channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "alerts",
            filter: `intended_for_user_id=eq.${userId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey: ["alerts", "own"] });
          },
        )
        .subscribe();
    }

    return () => {
      // Only the mount that actually subscribed tears it down — the other
      // mount's cleanup would otherwise remove a channel the first one's
      // cleanup already removed, which is harmless but redundant.
      if (!alreadySubscribed) {
        void supabase.removeChannel(channel);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
      // `app_screen` is admin-configurable data (alert_types is a
      // backoffice-writable bank, migration 0023), so it is not guaranteed to
      // be the absolute path the seeded rows use. React Router treats a
      // navigate() target with no leading slash as RELATIVE to the current
      // route, so a row saved as "customer/history" would resolve against
      // whatever screen the bell happened to be opened from and land
      // somewhere that doesn't exist. Normalizing here keeps the alert
      // pointing at one fixed screen regardless of where it was clicked.
      const screen = app_screen.startsWith("/") ? app_screen : `/${app_screen}`;
      const target =
        url_parameter && alert.display_record_id
          ? `${screen}?${url_parameter}=${encodeURIComponent(alert.display_record_id)}`
          : screen;
      navigate(target);
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
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
      >
        <Icon name="bell" />
        {unreadCount > 0 && (
          <span className="absolute end-0.5 top-0.5 flex h-4 min-w-4 ring-2 ring-surface items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-danger-ink">
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
              className="self-end rounded px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent-soft"
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
