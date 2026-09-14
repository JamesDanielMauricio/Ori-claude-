import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

interface NotificationSettingsRow {
  whatsapp_enabled: boolean;
  notify_growers_on_business_day_open: boolean;
  shop_open_whatsapp_enabled: boolean;
  close_arrangement_customer_whatsapp_enabled: boolean;
  close_arrangement_grower_whatsapp_enabled: boolean;
}

// Shared with the Shop screen's read-only summary cards (routes/backoffice/
// shop.tsx, queryKey ["shop-panel", "notification-settings"]) so a toggle
// flipped here is reflected there too, without those cards needing their own
// mutation or knowing this button exists.
const SETTINGS_QUERY_KEY = ["shop-panel", "notification-settings"] as const;

// The system-wide on/off switches, reachable from every backoffice screen —
// previously notification_settings had no write surface in the app at all
// (only a Table Editor/SQL update), even though the two read-only ToggleCards
// on the Shop screen have shown their state since that screen existed. Same
// placement pattern as ThemeToggle: sits in the sidebar footer because it
// acts on the whole app's configuration rather than navigating anywhere.
export function SettingsTogglesButton() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);

  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_settings")
        .select(
          "whatsapp_enabled, notify_growers_on_business_day_open, shop_open_whatsapp_enabled, close_arrangement_customer_whatsapp_enabled, close_arrangement_grower_whatsapp_enabled",
        )
        .single();
      if (error) throw error;
      return data as NotificationSettingsRow;
    },
  });

  // One mutation, keyed by which column it patches — RLS already restricts
  // both select and update on this table to the backoffice role (migration
  // 0023), so there's no client-side role check to duplicate here.
  const toggleMutation = useMutation({
    mutationFn: async (patch: Partial<NotificationSettingsRow>) => {
      const { error } = await supabase.from("notification_settings").update(patch).eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    },
    onError: (error: { message?: string }) => {
      showToast(`עדכון ההגדרה נכשל: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const settings = settingsQuery.data;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
      >
        <Icon name="columns" className="h-4 w-4 shrink-0" />
        הגדרות מערכת
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="הגדרות מערכת">
        <div className="flex flex-col gap-4">
          {settingsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : settingsQuery.isError ? (
            <p className="text-sm text-ink-muted">טעינת ההגדרות נכשלה.</p>
          ) : (
            <>
              <ToggleRow
                label="הודעות WhatsApp"
                description="מתג ראשי. כבוי חוסם כל שליחה, ללא תלות במתגים שמתחתיו."
                checked={settings?.whatsapp_enabled ?? false}
                disabled={toggleMutation.isPending}
                onChange={(checked) => toggleMutation.mutate({ whatsapp_enabled: checked })}
              />
              <ToggleRow
                label="הודעה למגדלים בפתיחת יום עסקים"
                description="הודעה לכל מגדל עם רשימה עונתית, ברגע שנפתח יום מסחר חדש."
                checked={settings?.notify_growers_on_business_day_open ?? false}
                disabled={toggleMutation.isPending}
                onChange={(checked) =>
                  toggleMutation.mutate({ notify_growers_on_business_day_open: checked })
                }
              />
              <ToggleRow
                label="הודעה ללקוחות בפתיחת חנות"
                description="הודעה לכל לקוח פעיל ברגע שהחנות נפתחת להזמנות."
                checked={settings?.shop_open_whatsapp_enabled ?? false}
                disabled={toggleMutation.isPending}
                onChange={(checked) => toggleMutation.mutate({ shop_open_whatsapp_enabled: checked })}
              />
              <ToggleRow
                label="הודעת סגירת יום ללקוחות"
                description="הודעה ללקוחות בעת סגירת הסידור היומי, עם סיכום מה סודר עבורם."
                checked={settings?.close_arrangement_customer_whatsapp_enabled ?? false}
                disabled={toggleMutation.isPending}
                onChange={(checked) =>
                  toggleMutation.mutate({ close_arrangement_customer_whatsapp_enabled: checked })
                }
              />
              <ToggleRow
                label="הודעת סגירת יום למגדלים"
                description="הודעה למגדלים בעת סגירת הסידור היומי, עם סיכום מה נמכר מהסחורה שלהם."
                checked={settings?.close_arrangement_grower_whatsapp_enabled ?? false}
                disabled={toggleMutation.isPending}
                onChange={(checked) =>
                  toggleMutation.mutate({ close_arrangement_grower_whatsapp_enabled: checked })
                }
              />
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-surface-muted p-3.5 ring-1 ring-inset ring-border">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
      </div>
      {/* A real switch, not a checkbox: this dialog exists specifically to
          make these settings interactive (they were previously read-only
          status pills), so the control itself should read as flippable at a
          glance. `role="switch"`/`aria-checked` is the native semantics for
          exactly this — a screen reader announces "on"/"off", not "checked". */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? "bg-accent" : "bg-surface ring-1 ring-inset ring-border-strong"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-card transition-transform duration-200 ${
            // `start-0.5` + a positive translate on RTL — `translate-x` still
            // moves in the DOM's physical +x direction regardless of
            // direction, which is the visual "end" side in RTL, so this
            // reads as the thumb sliding toward the "on" side correctly.
            checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"
          } start-0.5`}
        />
      </button>
    </div>
  );
}
