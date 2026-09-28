import {
  discardBusinessDayInputSchema,
  initiateBusinessDayInputSchema,
  LIFECYCLE_ERROR_CODES,
  openShopInputSchema,
  toDiscardBusinessDayRpcArgs,
  toInitiateBusinessDayRpcArgs,
  toOpenShopRpcArgs,
} from "@ori/domain/lifecycle-engine";
import { parseIsoDate, todayIsoDate } from "@ori/shared/dates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useReducer, useState } from "react";

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
  useTradingDaysInRange,
  type TradingDayView,
} from "@/lib/trading-day-view";

import { TradingDayCalendarPicker, TradingDayMonthGrid } from "./trading-day-calendar-picker";

// "discardDay" is "סגירת יום עסקים" pressed on a day whose shop never opened:
// the day is deleted rather than closed — see discardMutation.
type ConfirmAction = "initiate" | "openShop" | "closeShop" | "closeDay" | "discardDay" | null;

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
// to a day someone is merely looking back at. Starting a day doesn't read
// the picker either: its date is chosen in its own dialog (StartDayBody).
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
    // Every "trading-day" entry (lib/trading-day-view.tsx), not just the
    // shared "live open day" one: the open day — every date-aware screen
    // following live reads that one entry, so refetching it is what shows
    // them the new phase — and also the by-date and month-range entries
    // behind the calendars. Those have to follow a day being started or
    // deleted: the start-day dialog refuses dates the calendar says are
    // taken, so a stale month would block a date that was just freed, or
    // leave a just-taken one looking free.
    void queryClient.invalidateQueries({ queryKey: ["trading-day"] });
    // The Shop screen's own status/metrics queries key off the same data.
    void queryClient.invalidateQueries({ queryKey: ["shop-panel"] });
  }

  // Shared shape for the three transitions on an ALREADY-existing day
  // (open shop / close shop / close day): patch its `phase` in place, roll
  // back to whatever it was if the server refuses. Starting a day and
  // discarding one don't use it: there is no existing row to patch in the
  // first case and none left afterwards in the second, so both write the
  // server's own answer instead (see initiateMutation).
  function dayPhaseOptimistic(nextPhase: TradingDayView["phase"]) {
    return optimisticUpdate<TradingDayView | null, void>(
      queryClient,
      OPEN_TRADING_DAY_QUERY_KEY,
      (current) => (current ? { ...current, phase: nextPhase } : current),
    );
  }

  // No optimistic placeholder for starting a day. There used to be one — a
  // fake `optimistic-<uuid>` row written into the open-day cache while the
  // request was in flight — on the belief that no screen keyed a query off
  // that entry's id. The Shop screen does (through useTradingDayView): it
  // fired its daily_orders/daily_picks counts with the fake id, and the
  // server answered both with HTTP 400. The placeholder also bought nothing
  // visible: the dialog stays open, showing "מבצע…", until the request
  // settles, and the panel it would have updated is behind that dialog.
  // initiate_business_day returns the new row, so onSuccess writes the REAL
  // day into the cache instead — no fake id ever exists to be queried.
  const initiateMutation = useMutation({
    // `tradeDate` is the date picked in the "פתיחת יום עסקים" dialog
    // (StartDayBody below) — it used to be today's date, always. The dialog
    // builds it with todayIsoDate(cellDate): the LOCAL calendar date, never
    // a UTC-derived one. `toISOString().slice(0, 10)` converts to UTC first,
    // so every local moment between midnight and the offset (UTC+2/+3 here)
    // reports *yesterday*, and nothing downstream would reject that:
    // trading_days has no unique constraint on trade_date, only the partial
    // "one non-closed day" index. See @ori/shared/dates.
    mutationFn: async (tradeDate: string) => {
      const input = initiateBusinessDayInputSchema.parse({ tradeDate });
      const { data, error } = await supabase.rpc(
        "initiate_business_day",
        toInitiateBusinessDayRpcArgs(input),
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (newDay) => {
      const liveDay: TradingDayView = {
        id: newDay.id,
        trade_date: newDay.trade_date,
        phase: newDay.phase,
      };
      queryClient.setQueryData(OPEN_TRADING_DAY_QUERY_KEY, liveDay);
      showToast("יום העסקים נפתח.", "success");
      setConfirmAction(null);
      invalidate();
    },
    onError: (error: { message?: string }) => {
      showToast(`פתיחת היום נכשלה: ${errorMessage(error)}`, "error");
      setConfirmAction(null);
    },
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

  // "סגירת יום עסקים" on a day whose shop was never opened — the way out of
  // a day started on the wrong date. discard_business_day (migration 0059)
  // deletes the day and everything it owns, so the date can be started
  // again; it refuses any day that isn't still 'initiated', so a day that
  // went live can never be removed this way. It is passed the id of the day
  // on screen, not "whichever is open", so it deletes exactly the day the
  // dialog named.
  //
  // No optimistic update: this is irreversible, so the panel changes only
  // once the server confirms, while the dialog shows "מבצע…".
  const discardMutation = useMutation({
    mutationFn: async (tradingDayId: string) => {
      const input = discardBusinessDayInputSchema.parse({ tradingDayId });
      const { data, error } = await supabase.rpc(
        "discard_business_day",
        toDiscardBusinessDayRpcArgs(input),
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (deletedDay) => {
      queryClient.setQueryData<TradingDayView | null>(OPEN_TRADING_DAY_QUERY_KEY, null);
      // A sidebar pinned to the deleted day's date would keep showing a day
      // that no longer exists; send it back to following the live day.
      if (selectedDate === deletedDay.trade_date) setSelectedDate(null);
      showToast(
        `יום העסקים של ${SHORT_DATE_FORMAT.format(parseIsoDate(deletedDay.trade_date))} נמחק. אפשר לפתוח את התאריך מחדש.`,
        "success",
      );
      setConfirmAction(null);
      invalidate();
    },
    onError: (error: { code?: string; message?: string }) => {
      showToast(`מחיקת יום העסקים נכשלה: ${discardErrorMessage(error)}`, "error");
      setConfirmAction(null);
    },
  });

  const busy =
    initiateMutation.isPending ||
    openShopMutation.isPending ||
    closeShopMutation.isPending ||
    closeDayMutation.isPending ||
    discardMutation.isPending;

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
  //
  // The two are different acts. After the shop has closed it is the normal
  // close (close_arrangement). Before it ever opened, the day is DELETED
  // (discard_business_day), so a day started on the wrong date frees that
  // date instead of occupying it forever — close_arrangement refuses a day
  // in phase 'initiated' anyway.
  const closeDayEnabled = phase === "initiated" || phase === "shop_closed";
  const closeDayAction: ConfirmAction = phase === "initiated" ? "discardDay" : "closeDay";

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
          onClick={() => setConfirmAction(closeDayAction)}
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
        {/* Mounted only while open, so it starts from today's date every
            time the dialog opens, and its calendar queries nothing on the
            screens where nobody opens it. Dialog keeps showing this content
            through its own closing animation (see ui/dialog.tsx). */}
        {confirmAction === "initiate" && (
          <StartDayBody
            busy={initiateMutation.isPending}
            onCancel={() => setConfirmAction(null)}
            onConfirm={(tradeDate) => initiateMutation.mutate(tradeDate)}
          />
        )}
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

      {/* Same title and button as the normal close — it is the same
          "סגירת יום עסקים" the person pressed — but the text says plainly
          that this one deletes, names the date, and the confirm button is
          the destructive red. Mounted only while open, and only while there
          is a day to name (see StartDayBody's dialog for the same pattern). */}
      <Dialog
        open={confirmAction === "discardDay"}
        onClose={() => setConfirmAction(null)}
        title="סגירת יום עסקים"
      >
        {confirmAction === "discardDay" && day && (
          <ConfirmBody
            text={`החנות לא נפתחה ביום העסקים של ${LONG_DATE_FORMAT.format(parseIsoDate(day.trade_date))}, ולכן סגירתו תמחק אותו לגמרי: רשימות הקטיף שנוצרו למגדלים וכל מה שהוזן בהן יימחקו, והתאריך יתפנה לפתיחה מחדש. לא ניתן לבטל פעולה זו.`}
            note="הודעות WhatsApp על פתיחת היום שכבר נשלחו למגדלים לא יבוטלו."
            confirmLabel="מחק את יום העסקים"
            danger
            busy={discardMutation.isPending}
            onCancel={() => setConfirmAction(null)}
            onConfirm={() => discardMutation.mutate(day.id)}
          />
        )}
      </Dialog>
    </div>
  );
}

function ConfirmBody({
  text,
  note,
  confirmLabel,
  danger = false,
  busy,
  onCancel,
  onConfirm,
}: {
  text: string;
  // A secondary line under the main text, in muted ink.
  note?: string;
  confirmLabel: string;
  // The red button, for the one confirm here that deletes rather than moves
  // the day forward.
  danger?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">{text}</p>
      {note && <p className="text-sm text-ink-muted">{note}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          ביטול
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
          {busy ? "מבצע…" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("he-IL", { dateStyle: "short" });
// Without the weekday: "30 בספטמבר 2026". The full style starts with "יום …",
// which after "ביום העסקים של" would read "יום" twice.
const LONG_DATE_FORMAT = new Intl.DateTimeFormat("he-IL", { dateStyle: "long" });

// The toast text for a refused discard. The two refusals a person can
// actually meet get a Hebrew sentence (the server's own messages are
// English); anything else — a network failure, the migration not yet
// applied — falls through to the raw message, which is the useful one then.
function discardErrorMessage(error: { code?: string; message?: string }): string {
  if (error.code === LIFECYCLE_ERROR_CODES.INVALID_STATE) {
    return "היום כבר אינו במצב שבו אפשר למחוק אותו — ייתכן שהחנות נפתחה בינתיים.";
  }
  if (error.code === LIFECYCLE_ERROR_CODES.NOT_FOUND) return "יום המסחר כבר לא קיים.";
  return errorMessage(error);
}

const FULL_DATE_FORMAT = new Intl.DateTimeFormat("he-IL", { dateStyle: "full" });

// The "פתיחת יום עסקים" dialog's body: ConfirmBody plus a calendar for the
// new day's date. The date is chosen HERE, never taken from the sidebar's
// calendar — that one only chooses which existing day the screens show (see
// the note above BusinessDayPanel), and opening a day is a different act.
//
// The calendar is the sidebar's own month grid (TradingDayMonthGrid), not a
// native date field, for the reason that grid exists at all: it marks the
// dates that already have a trading day.
//
// Two kinds of date can't be chosen (James, 2026-09-28): a date that already
// has a trading day, and a date in the past. Both are disabled in the grid.
// The duplicate rule is ALSO checked for the chosen date on its own, fresh
// from the server, before "פתח יום עסקים" is enabled: the grid's marks come
// from a month query that may still be loading when someone clicks, and the
// dialog opens on today, which may itself already be taken. Nothing in the
// database refuses a duplicate or past date (no unique constraint on
// trade_date, no date check in initiate_business_day — the test suites
// deliberately start days on fixed past dates and repeatedly on today), so
// this dialog is where the rule lives.
//
// Starts on today, so the usual case stays one click. The chosen date is
// spelled out in full above the buttons because it leaves the app: the
// server sends it to every eligible grower's WhatsApp on confirm.
function StartDayBody({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (tradeDate: string) => void;
}) {
  const [tradeDate, setTradeDate] = useState(() => todayIsoDate());
  const [viewDate, setViewDate] = useState(() => parseIsoDate(tradeDate));
  // Re-read on every render, not frozen at mount: the dialog can sit open
  // across midnight, and yesterday must not stay pickable. handleConfirm
  // forces one more render when that happens (see there).
  const today = todayIsoDate();
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // Just the chosen date, so the answer is right even after the calendar
  // has been paged to another month.
  const existingDayQuery = useTradingDaysInRange(tradeDate, tradeDate);
  const dateTaken = (existingDayQuery.data ?? []).length > 0;
  const dateInPast = tradeDate < today;
  // A FRESH answer, not a cached one: the query is keyed by date and cached,
  // so reopening the dialog shows the last known answer while it refetches —
  // and a date freed a moment ago (a discarded day) or taken a moment ago
  // must not be judged by that. isFetching covers the refetch.
  const dateChecked = existingDayQuery.isSuccess && !existingDayQuery.isFetching;
  const canConfirm = !busy && dateChecked && !dateTaken && !dateInPast;

  function handleConfirm() {
    // The render this click came from may predate midnight. Re-check against
    // the real clock; if the date has become the past, re-render so the
    // dialog says so and disables itself, instead of starting a past day.
    if (tradeDate < todayIsoDate()) {
      rerender();
      return;
    }
    onConfirm(tradeDate);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        ייפתח יום מסחר חדש לתאריך שתבחר, ולכל מגדל פעיל עם מוצרים בעונה תיווצר רשימת קטיף ריקה.
      </p>

      {/* The same frame the sidebar's popover gives this grid, so it reads
          as the same calendar; capped at that popover's width, which is
          also what fits a phone's dialog. */}
      <div className="mx-auto w-full max-w-[19rem] rounded-xl border border-border p-3">
        <TradingDayMonthGrid
          viewDate={viewDate}
          onViewDateChange={setViewDate}
          selectedDate={tradeDate}
          // No day is open — this dialog is only reachable when none is.
          liveDate={null}
          onSelect={setTradeDate}
          isDateDisabled={(date, hasTradingDay) => hasTradingDay || date < today}
        />
      </div>

      {/* A live region, so a screen reader hears the newly chosen date — and
          the message, when one appears — as each date is picked. The date
          line lives inside it too, which keeps the region from being an
          empty flex child that would still take up a gap. */}
      <div aria-live="polite" className="flex flex-col gap-3">
        <p className="text-sm">
          תאריך יום המסחר:{" "}
          <span className="font-semibold">{FULL_DATE_FORMAT.format(parseIsoDate(tradeDate))}</span>
        </p>
        {dateInPast ? (
          <p className="flex items-start gap-2.5 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning ring-1 ring-inset ring-warning/20">
            <Icon name="alertCircle" className="mt-px h-4 w-4 shrink-0" />
            <span>התאריך הזה כבר עבר. בחר את היום או תאריך מאוחר יותר.</span>
          </p>
        ) : dateTaken ? (
          <p className="flex items-start gap-2.5 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning ring-1 ring-inset ring-warning/20">
            <Icon name="alertCircle" className="mt-px h-4 w-4 shrink-0" />
            <span>כבר קיים יום מסחר בתאריך זה. בחר תאריך אחר.</span>
          </p>
        ) : existingDayQuery.isError && !existingDayQuery.isFetching ? (
          // Failed to check — so the date can't be vouched for, and the
          // confirm stays off. Retry here rather than making the person
          // close and reopen the dialog.
          <div className="flex items-center justify-between gap-3 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/20">
            <span className="flex items-start gap-2.5">
              <Icon name="alertCircle" className="mt-px h-4 w-4 shrink-0" />
              בדיקת התאריך נכשלה, ולכן אי אפשר לפתוח עליו יום.
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void existingDayQuery.refetch()}
            >
              נסה שוב
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          ביטול
        </Button>
        <Button onClick={handleConfirm} disabled={!canConfirm}>
          {busy ? "מבצע…" : "פתח יום עסקים"}
        </Button>
      </div>
    </div>
  );
}
