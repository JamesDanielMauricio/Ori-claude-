import {
  initiateBusinessDayInputSchema,
  openShopInputSchema,
  toInitiateBusinessDayRpcArgs,
  toOpenShopRpcArgs,
} from "@ori/domain/lifecycle-engine";
import { todayIsoDate } from "@ori/shared/dates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { checkboxClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/error-message";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";
import {
  OPEN_TRADING_DAY_QUERY_KEY,
  useOpenTradingDay,
  useSelectedTradingDay,
  type TradingDayView,
} from "@/lib/trading-day-view";

import { TradingDayCalendarPicker } from "./trading-day-calendar-picker";

type ConfirmAction = "initiate" | "openShop" | "closeShop" | "closeDay" | null;

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
// time, this renders both slots always (per the actual sidebar screenshots
// this was built against) and disables whichever isn't the current step —
// the underlying rule ("only the phase-appropriate action is actually
// callable") is identical; only the rendering choice differs.
//
// A third button used to sit here, "עדכון מלאי למגדלים" (update_growers_data).
// It was the manual way to re-sync growers' pick lists after their in-season
// list changed mid-day, and it was the only thing that did — save_grower
// didn't touch daily_picks at all. Migration 0037 moved that reconcile into
// save_grower itself, so the sync now happens in the same transaction as the
// edit that requires it and there is nothing left to remember. The RPC still
// exists as a bulk/repair path; it is deliberately no longer wired to a
// control here, because it is a data refresh and this panel is the day's
// lifecycle (open day → open shop → close shop → close day).
//
// The date shown here is a picker (lib/trading-day-view.tsx): choosing a
// past date pins every date-aware backoffice screen — Shop, Arrangement,
// Grower Inventory Status, Customer Order Status — to that day's own data
// instead of the live one, read-only, until "חזרה ליום הפעיל" clears it (or
// until the picker is pointed back at the live day's own date, which
// useTradingDayView treats as equivalent to unpinned for editing purposes).
// The lifecycle buttons below are deliberately UNAFFECTED by that pin — they
// always act on the actual open day (useOpenTradingDay, not the picked
// date), because there is only ever one non-closed trading day at a time
// (trading_days_single_open_idx) and "open the shop" has no meaning applied
// to a day someone is merely looking back at.
export function BusinessDayPanel() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [canSeePrices, setCanSeePrices] = useState(true);

  const openDayQuery = useOpenTradingDay();
  const day = openDayQuery.data ?? null;
  const phase = day?.phase;

  const { selectedDate, setSelectedDate } = useSelectedTradingDay();
  // Not just `selectedDate !== null`: once the picked date equals the live
  // day's own date, useTradingDayView already treats every other screen's
  // data as editable/live again (lib/trading-day-view.tsx), so this link
  // would offer to "go back" to somewhere already being shown — hide it
  // rather than leave a no-op affordance on screen.
  const isViewingPinnedDate = selectedDate !== null && selectedDate !== day?.trade_date;

  const shopQueryKey = ["business-day-panel", "shop", day?.id] as const;

  // Read-only display of the flag once the shop is already open — this
  // panel doesn't add a way to change it after the fact; canSeePrices is
  // still only ever set at open_shop time (the checkbox below it).
  const shopQuery = useQuery({
    queryKey: shopQueryKey,
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
    // The shared "live open day" entry (lib/trading-day-view.tsx) — every
    // date-aware screen currently following live reads this same cache
    // entry, so refetching it here is what shows them the new phase without
    // each needing its own invalidation call.
    void queryClient.invalidateQueries({ queryKey: OPEN_TRADING_DAY_QUERY_KEY });
    // The Shop screen's own status/metrics queries key off the same data.
    void queryClient.invalidateQueries({ queryKey: ["shop-panel"] });
  }

  // Shared shape for the three transitions on an ALREADY-existing day
  // (open shop / close shop / close day): patch its `phase` in place, roll
  // back to whatever it was if the server refuses. `initiateMutation` below
  // is the one transition with no existing row to patch, so it builds its
  // own updater instead of using this.
  function dayPhaseOptimistic(nextPhase: TradingDayView["phase"]) {
    return optimisticUpdate<TradingDayView | null, void>(
      queryClient,
      OPEN_TRADING_DAY_QUERY_KEY,
      (current) => (current ? { ...current, phase: nextPhase } : current),
    );
  }

  const initiateOptimistic = optimisticUpdate<TradingDayView | null, void>(
    queryClient,
    OPEN_TRADING_DAY_QUERY_KEY,
    (current) =>
      current ?? {
        // No real id yet — initiate_business_day creates the row
        // server-side. A placeholder is safe here ONLY because `busy`
        // (below) disables every lifecycle button, this one included,
        // while this mutation is pending, so nothing in this panel can act
        // on the fake id before invalidate() replaces it with the real row.
        // Any other mounted screen keyed off a real day id doesn't read
        // this particular cache entry today (grep OPEN_TRADING_DAY_QUERY_KEY
        // before changing that); if one ever does, the existing realtime
        // subscription on trading_days (lib/trading-day-view.tsx) and this
        // mutation's own onSettled-style invalidate both correct it the
        // moment the real row lands, success or failure.
        id: `optimistic-${crypto.randomUUID()}`,
        trade_date: todayIsoDate(),
        phase: "initiated",
      },
  );

  const initiateMutation = useMutation({
    mutationFn: async () => {
      // The local calendar date, never a UTC-derived one. `toISOString()
      // .slice(0, 10)` converts to UTC first, so every local moment between
      // midnight and the offset (UTC+2/+3 here) reports *yesterday* — opening
      // the day at 01:00 would stamp it with the previous date, and nothing
      // downstream rejects that: trading_days has no unique constraint on
      // trade_date, only the partial "one non-closed day" index. See
      // @ori/shared/dates.
      const tradeDate = todayIsoDate();
      const input = initiateBusinessDayInputSchema.parse({ tradeDate });
      const { error } = await supabase.rpc(
        "initiate_business_day",
        toInitiateBusinessDayRpcArgs(input),
      );
      if (error) throw error;
    },
    onMutate: initiateOptimistic.onMutate,
    onSuccess: () => {
      showToast("יום העסקים נפתח.", "success");
      setConfirmAction(null);
      invalidate();
    },
    onError: mergeOnError(initiateOptimistic.onError, (error: { message?: string }) => {
      showToast(`פתיחת היום נכשלה: ${errorMessage(error)}`, "error");
      setConfirmAction(null);
    }),
  });

  const openShopPhaseOptimistic = dayPhaseOptimistic("shop_open");

  const openShopMutation = useMutation({
    mutationFn: async () => {
      const input = openShopInputSchema.parse({ canSeePrices });
      const { error } = await supabase.rpc("open_shop", toOpenShopRpcArgs(input));
      if (error) throw error;
    },
    onMutate: async () => {
      const context = await openShopPhaseOptimistic.onMutate(undefined);
      // Seeds the read-only "לקוחות מורשים רואים מחירים" checkbox with the
      // value this same click is choosing, so it doesn't sit blank/default
      // for the round trip — the real row lands moments later (invalidate()
      // below) and simply confirms it. No rollback needed: on failure the
      // phase patch above reverts, `shopQuery` goes back to disabled
      // (`enabled: phase === "shop_open"`), and this seed just sits unused.
      queryClient.setQueryData(shopQueryKey, { can_see_prices: canSeePrices });
      return context;
    },
    onSuccess: () => {
      showToast("החנות נפתחה.", "success");
      setConfirmAction(null);
      invalidate();
    },
    onError: mergeOnError(openShopPhaseOptimistic.onError, (error: { message?: string }) => {
      showToast(`פתיחת החנות נכשלה: ${errorMessage(error)}`, "error");
      setConfirmAction(null);
    }),
  });

  const closeShopPhaseOptimistic = dayPhaseOptimistic("shop_closed");

  const closeShopMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_shop");
      if (error) throw error;
    },
    onMutate: closeShopPhaseOptimistic.onMutate,
    onSuccess: () => {
      showToast("החנות נסגרה.", "success");
      setConfirmAction(null);
      invalidate();
    },
    onError: mergeOnError(closeShopPhaseOptimistic.onError, (error: { message?: string }) => {
      showToast(`סגירת החנות נכשלה: ${errorMessage(error)}`, "error");
      setConfirmAction(null);
    }),
  });

  const closeDayPhaseOptimistic = dayPhaseOptimistic("closed");

  const closeDayMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_arrangement");
      if (error) throw error;
    },
    onMutate: closeDayPhaseOptimistic.onMutate,
    onSuccess: () => {
      showToast("יום העסקים נסגר.", "success");
      setConfirmAction(null);
      invalidate();
    },
    onError: mergeOnError(closeDayPhaseOptimistic.onError, (error: { message?: string }) => {
      showToast(`סגירת יום העסקים נכשלה: ${errorMessage(error)}`, "error");
      setConfirmAction(null);
    }),
  });

  const busy =
    initiateMutation.isPending ||
    openShopMutation.isPending ||
    closeShopMutation.isPending ||
    closeDayMutation.isPending;

  if (openDayQuery.isLoading) {
    return <Skeleton className="mx-3 my-3 h-28" />;
  }

  // Never loaded at all. Without this the panel fell through to the "no day
  // is open" state and offered "פתח יום עסקים" — an action the
  // single-open-day index then refuses whenever a day is in fact open. A
  // real "no open day" answer is `null`, not undefined, so it still gets
  // that button.
  if (openDayQuery.isError && openDayQuery.data === undefined) {
    return (
      <div className="flex flex-col gap-2 border-b border-border bg-surface-muted px-3 py-3">
        <p role="alert" className="flex items-start gap-2 px-1 text-xs text-danger">
          <Icon name="alertCircle" className="mt-px h-4 w-4 shrink-0" />
          טעינת מצב יום המסחר נכשלה.
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={openDayQuery.isFetching}
          onClick={() => void openDayQuery.refetch()}
          className="w-full"
        >
          {openDayQuery.isFetching ? "מנסה שוב…" : "נסה שוב"}
        </Button>
      </div>
    );
  }

  // The toggle slot: initiate (no day) -> open shop (day started) ->
  // close shop (shop taking orders) -> stays "open shop", disabled, once
  // the shop has already closed for the day (forward-only).
  const toggle =
    phase === undefined
      ? {
          label: "פתח יום עסקים",
          disabled: false,
          onClick: () => setConfirmAction("initiate" as const),
        }
      : phase === "initiated"
        ? {
            label: "פתח חנות",
            disabled: false,
            onClick: () => setConfirmAction("openShop" as const),
          }
        : phase === "shop_open"
          ? {
              label: "סגור חנות",
              disabled: false,
              onClick: () => setConfirmAction("closeShop" as const),
            }
          : { label: "פתח חנות", disabled: true, onClick: () => {} };

  // Close-business-day only makes sense before the shop has opened (the
  // "opened by mistake" bail-out) or after it's already closed (the
  // normal end of day) — never while the shop is actively taking orders,
  // where closing the shop has to happen first.
  const closeDayEnabled = phase === "initiated" || phase === "shop_closed";

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-surface-muted px-3 py-3">
      {/* The day this whole backoffice area is showing. Picking a date here
          pins Shop, Arrangement, Grower Inventory Status and Customer Order
          Status to that day's own data — read-only, unless the picked date
          is itself the live day's date — until "חזרה ליום הפעיל" clears it.
          See lib/trading-day-view.tsx for why that pin is deliberately kept
          separate from the lifecycle actions beneath it. */}
      <TradingDayCalendarPicker
        selectedDate={selectedDate}
        liveDate={day?.trade_date ?? null}
        onSelect={setSelectedDate}
      />

      {isViewingPinnedDate && (
        <button
          type="button"
          onClick={() => setSelectedDate(null)}
          className="flex items-center gap-1 self-start px-1 text-xs font-semibold text-accent transition-colors hover:text-accent-hover"
        >
          <Icon name="chevronStart" className="h-3 w-3" />
          חזרה ליום הפעיל
          {day &&
            ` (${new Intl.DateTimeFormat("he-IL", { dateStyle: "short" }).format(new Date(day.trade_date))})`}
        </button>
      )}

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

      {phase === "initiated" && (
        <label className="flex items-center gap-2 px-1 text-xs text-ink-muted">
          <input
            type="checkbox"
            className={checkboxClassName}
            checked={canSeePrices}
            onChange={(event) => setCanSeePrices(event.target.checked)}
          />
          לקוחות רואים מחירים בפתיחת החנות
        </label>
      )}
      {phase === "shop_open" && (
        <label className="flex items-center gap-2 px-1 text-xs text-ink-muted">
          <input
            type="checkbox"
            className={checkboxClassName}
            checked={shopQuery.data?.can_see_prices ?? true}
            disabled
            readOnly
          />
          לקוחות מורשים רואים מחירים
        </label>
      )}

      <Dialog
        open={confirmAction === "initiate"}
        onClose={() => setConfirmAction(null)}
        title="פתיחת יום עסקים"
      >
        <ConfirmBody
          text="ייפתח יום מסחר חדש לתאריך של היום, ולכל מגדל פעיל עם מוצרים בעונה תיווצר רשימת קטיף ריקה."
          confirmLabel="פתח יום עסקים"
          busy={initiateMutation.isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => initiateMutation.mutate()}
        />
      </Dialog>

      <Dialog
        open={confirmAction === "openShop"}
        onClose={() => setConfirmAction(null)}
        title="פתיחת חנות"
      >
        <ConfirmBody
          text={`החנות תיפתח להזמנות. מחירים ${canSeePrices ? "יוצגו" : "לא יוצגו"} ללקוחות.`}
          confirmLabel="פתח חנות"
          busy={openShopMutation.isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => openShopMutation.mutate()}
        />
      </Dialog>

      <Dialog
        open={confirmAction === "closeShop"}
        onClose={() => setConfirmAction(null)}
        title="סגירת חנות"
      >
        <ConfirmBody
          text="לקוחות לא יוכלו יותר לשלוח או לעדכן הזמנות להיום. מגדלים עדיין יכולים לעדכן ליקוטים עד סגירת הסידור."
          confirmLabel="סגור חנות"
          busy={closeShopMutation.isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => closeShopMutation.mutate()}
        />
      </Dialog>

      <Dialog
        open={confirmAction === "closeDay"}
        onClose={() => setConfirmAction(null)}
        title="סגירת יום עסקים"
      >
        <ConfirmBody
          text="הסידור ייסגר סופית, כל רשימות הקטיף להיום ייסגרו, והיום יסתיים. לא ניתן לבטל פעולה זו."
          confirmLabel="סגור יום עסקים"
          busy={closeDayMutation.isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => closeDayMutation.mutate()}
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
