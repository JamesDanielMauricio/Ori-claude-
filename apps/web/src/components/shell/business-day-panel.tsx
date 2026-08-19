"use client";

import {
  initiateBusinessDayInputSchema,
  openShopInputSchema,
  toInitiateBusinessDayRpcArgs,
  toOpenShopRpcArgs,
} from "@ori/domain/lifecycle-engine";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

type Phase = "initiated" | "shop_open" | "shop_closed" | "closed";

interface OpenDay {
  id: string;
  trade_date: string;
  phase: Phase;
}

type ConfirmAction = "initiate" | "openShop" | "closeShop" | "closeDay" | "update" | null;

// The source app's persistent sidebar lifecycle panel (see the "Business
// Day Lifecycle" semantic-layer doc and reference/prd/daily-trading-lifecycle.md),
// rebuilt on the real `trading_days.phase` column instead of the source's
// `appsettings.visible_buttons` singleton flag (R2). This REPLACES the
// button controls that used to live on the Shop screen (shop/page.tsx) —
// moved, not duplicated, so there is exactly one write surface per
// transition (R5) — and is mounted once in BackofficeNav so it's visible
// on every backoffice screen, matching the source.
//
// Unlike the source, which shows exactly one "next action" button at a
// time, this renders all three slots always (per the actual sidebar
// screenshots this was built against) and disables whichever isn't the
// current step — the underlying rule ("only the phase-appropriate action
// is actually callable") is identical; only the rendering choice differs.
export function BusinessDayPanel() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [canSeePrices, setCanSeePrices] = useState(true);

  const openDayQuery = useQuery({
    queryKey: ["business-day-panel", "open-trading-day"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("id, trade_date, phase")
        .neq("phase", "closed")
        .maybeSingle();
      if (error) throw error;
      return data as OpenDay | null;
    },
    refetchInterval: 60000,
  });
  const day = openDayQuery.data ?? null;
  const phase = day?.phase;

  // Read-only display of the flag once the shop is already open — this
  // panel doesn't add a way to change it after the fact; canSeePrices is
  // still only ever set at open_shop time (the checkbox below it).
  const shopQuery = useQuery({
    queryKey: ["business-day-panel", "shop", day?.id],
    enabled: phase === "shop_open",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_shops")
        .select("can_see_prices")
        .eq("trading_day_id", day!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["business-day-panel"] });
    // The Shop screen's own status/metrics queries key off the same data.
    void queryClient.invalidateQueries({ queryKey: ["shop-panel"] });
  }

  const initiateMutation = useMutation({
    mutationFn: async () => {
      const tradeDate = new Date().toISOString().slice(0, 10);
      const input = initiateBusinessDayInputSchema.parse({ tradeDate });
      const { error } = await supabase.rpc("initiate_business_day", toInitiateBusinessDayRpcArgs(input));
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("יום העסקים נפתח.", "success");
      setConfirmAction(null);
      invalidate();
    },
    onError: (error: { message?: string }) => {
      showToast(`פתיחת היום נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
      setConfirmAction(null);
    },
  });

  const openShopMutation = useMutation({
    mutationFn: async () => {
      const input = openShopInputSchema.parse({ canSeePrices });
      const { error } = await supabase.rpc("open_shop", toOpenShopRpcArgs(input));
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("החנות נפתחה.", "success");
      setConfirmAction(null);
      invalidate();
    },
    onError: (error: { message?: string }) => {
      showToast(`פתיחת החנות נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
      setConfirmAction(null);
    },
  });

  const closeShopMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_shop");
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("החנות נסגרה.", "success");
      setConfirmAction(null);
      invalidate();
    },
    onError: (error: { message?: string }) => {
      showToast(`סגירת החנות נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
      setConfirmAction(null);
    },
  });

  const closeDayMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_arrangement");
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("יום העסקים נסגר.", "success");
      setConfirmAction(null);
      invalidate();
    },
    onError: (error: { message?: string }) => {
      showToast(`סגירת יום העסקים נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
      setConfirmAction(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("update_growers_data");
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("מלאי המגדלים עודכן.", "success");
      setConfirmAction(null);
      invalidate();
    },
    onError: (error: { message?: string }) => {
      showToast(`עדכון המלאי נכשל: ${error.message ?? "שגיאה לא ידועה"}`, "error");
      setConfirmAction(null);
    },
  });

  const busy =
    initiateMutation.isPending ||
    openShopMutation.isPending ||
    closeShopMutation.isPending ||
    closeDayMutation.isPending ||
    updateMutation.isPending;

  if (openDayQuery.isLoading) {
    return <div className="mx-3 my-3 h-28 animate-pulse rounded-md bg-canvas" />;
  }

  // The toggle slot: initiate (no day) -> open shop (day started) ->
  // close shop (shop taking orders) -> stays "open shop", disabled, once
  // the shop has already closed for the day (forward-only).
  const toggle =
    phase === undefined
      ? { label: "פתח יום עסקים", disabled: false, onClick: () => setConfirmAction("initiate" as const) }
      : phase === "initiated"
        ? { label: "פתח חנות", disabled: false, onClick: () => setConfirmAction("openShop" as const) }
        : phase === "shop_open"
          ? { label: "סגור חנות", disabled: false, onClick: () => setConfirmAction("closeShop" as const) }
          : { label: "פתח חנות", disabled: true, onClick: () => {} };

  // Close-business-day only makes sense before the shop has opened (the
  // "opened by mistake" bail-out) or after it's already closed (the
  // normal end of day) — never while the shop is actively taking orders,
  // where closing the shop has to happen first.
  const closeDayEnabled = phase === "initiated" || phase === "shop_closed";
  const updateEnabled = phase !== undefined;

  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-3">
      <p className="px-1 text-xs font-semibold text-ink-muted">
        {day
          ? new Intl.DateTimeFormat("he-IL", { dateStyle: "short" }).format(new Date(day.trade_date))
          : "אין יום מסחר פתוח"}
      </p>

      {phase !== undefined && (
        <Button
          variant="secondary"
          disabled={busy || !closeDayEnabled}
          onClick={() => setConfirmAction("closeDay")}
          className="w-full"
        >
          סגירת יום עסקים
        </Button>
      )}

      <Button disabled={busy || toggle.disabled} onClick={toggle.onClick} className="w-full">
        {toggle.label}
      </Button>

      <Button
        variant="secondary"
        disabled={busy || !updateEnabled}
        onClick={() => setConfirmAction("update")}
        className="w-full"
      >
        עדכון מלאי למגדלים
      </Button>

      {phase === "initiated" && (
        <label className="flex items-center gap-2 px-1 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={canSeePrices}
            onChange={(event) => setCanSeePrices(event.target.checked)}
          />
          לקוחות רואים מחירים בפתיחת החנות
        </label>
      )}
      {phase === "shop_open" && (
        <label className="flex items-center gap-2 px-1 text-xs text-ink-muted">
          <input type="checkbox" checked={shopQuery.data?.can_see_prices ?? true} disabled readOnly />
          לקוחות מורשים רואים מחירים
        </label>
      )}

      <Dialog open={confirmAction === "initiate"} onClose={() => setConfirmAction(null)} title="פתיחת יום עסקים">
        <ConfirmBody
          text="ייפתח יום מסחר חדש לתאריך של היום, ולכל מגדל פעיל עם מוצרים בעונה תיווצר רשימת קטיף ריקה."
          confirmLabel="פתח יום עסקים"
          busy={initiateMutation.isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => initiateMutation.mutate()}
        />
      </Dialog>

      <Dialog open={confirmAction === "openShop"} onClose={() => setConfirmAction(null)} title="פתיחת חנות">
        <ConfirmBody
          text={`החנות תיפתח להזמנות. מחירים ${canSeePrices ? "יוצגו" : "לא יוצגו"} ללקוחות.`}
          confirmLabel="פתח חנות"
          busy={openShopMutation.isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => openShopMutation.mutate()}
        />
      </Dialog>

      <Dialog open={confirmAction === "closeShop"} onClose={() => setConfirmAction(null)} title="סגירת חנות">
        <ConfirmBody
          text="לקוחות לא יוכלו יותר לשלוח או לעדכן הזמנות להיום. מגדלים עדיין יכולים לעדכן ליקוטים עד סגירת הסידור."
          confirmLabel="סגור חנות"
          busy={closeShopMutation.isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => closeShopMutation.mutate()}
        />
      </Dialog>

      <Dialog open={confirmAction === "closeDay"} onClose={() => setConfirmAction(null)} title="סגירת יום עסקים">
        <ConfirmBody
          text="הסידור ייסגר סופית, כל רשימות הקטיף להיום ייסגרו, והיום יסתיים. לא ניתן לבטל פעולה זו."
          confirmLabel="סגור יום עסקים"
          busy={closeDayMutation.isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => closeDayMutation.mutate()}
        />
      </Dialog>

      <Dialog open={confirmAction === "update"} onClose={() => setConfirmAction(null)} title="עדכון מלאי למגדלים">
        <ConfirmBody
          text="רשימות הקטיף של כל המגדלים הפעילים יסונכרנו מחדש מול רשימת המוצרים העונתית העדכנית שלהם. שינויים שכבר נכללו בסידור לא יימחקו."
          confirmLabel="עדכן מלאי"
          busy={updateMutation.isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => updateMutation.mutate()}
        />
      </Dialog>
    </div>
  );
}

function ConfirmBody({
  text,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  text: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">{text}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          ביטול
        </Button>
        <Button onClick={onConfirm} disabled={busy}>
          {busy ? "מבצע…" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
