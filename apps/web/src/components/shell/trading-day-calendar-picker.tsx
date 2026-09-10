import { parseIsoDate, todayIsoDate } from "@ori/shared/dates";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/ui/icon";
import { useTradingDaysInRange } from "@/lib/trading-day-view";

// Sunday..Saturday, narrow Hebrew labels (א׳ ב׳ …) — generated rather than
// hardcoded so it can't drift from what Intl actually renders for this
// locale. The reference week is "whatever week contains right now, walked
// back to its own Sunday" — any week works, only the day-of-week identity
// of each column matters.
const WEEKDAY_LABELS: string[] = (() => {
  const now = new Date();
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const formatter = new Intl.DateTimeFormat("he-IL", { weekday: "narrow" });
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(sunday);
    day.setDate(sunday.getDate() + i);
    return formatter.format(day);
  });
})();

const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" });
const CELL_LABEL_FORMAT = new Intl.DateTimeFormat("he-IL", { dateStyle: "long" });

// The 42-cell (6×7) grid for the month `viewDate` falls in, Sunday-first —
// which lands Sunday on the RIGHT in this app's RTL layout, matching the
// Israeli convention, entirely from CSS grid auto-placement respecting the
// page's own `dir`; nothing here has to know it's RTL. Always 6 rows, even
// when the last is all next-month padding, so the popover doesn't change
// height as you page between months.
function buildMonthGrid(viewDate: Date): Date[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    return day;
  });
}

// The sidebar's trigger + its calendar popover, portaled to <body> the same
// way the shared Dialog is (see that component's own comment): the popover
// floats over the main content, not inside the rail's dark subtree, so it
// renders on the app's normal light "paper" tokens rather than needing its
// own dark-mode styling for a control that only ever appears away from the
// rail's own background.
//
// A native <input type="date"> used to sit here. It could highlight nothing
// — every day option looked identical whether or not a trading day existed
// on it — so paging through a month to find "was there a day on the 14th
// or the 15th" was a guess. This grid answers that at a glance instead.
export function TradingDayCalendarPicker({
  selectedDate,
  liveDate,
  onSelect,
}: {
  // The pinned date, or null when following the live day — see
  // lib/trading-day-view.tsx's SelectedTradingDayState.
  selectedDate: string | null;
  // The live open day's own date, or null if none is open. Used for the
  // trigger's fallback label, the grid's own "this is the active day"
  // marker, and where the popover's month view opens to when nothing is
  // pinned yet.
  liveDate: string | null;
  onSelect: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState<Date>(() =>
    parseIsoDate(selectedDate ?? liveDate ?? todayIsoDate()),
  );
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function openPopover() {
    setViewDate(parseIsoDate(selectedDate ?? liveDate ?? todayIsoDate()));
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Right-anchored, growing toward the inline end (left, in this RTL
      // app): the rail this trigger lives in is itself pinned to the
      // viewport's right edge, so a right-anchored popover can never be
      // clipped by it the way a left-anchored one could.
      setPosition({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    }
    setOpen(true);
  }

  // Click-outside and Escape close the popover, same as any non-modal
  // popover — this one isn't built on the shared Dialog (a centered modal
  // with a backdrop) because a calendar anchored under its trigger is a
  // different shape of control, not a variant of a confirm/edit dialog.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  // Deliberately [year, month], not viewDate: buildMonthGrid only reads
  // those two fields, and `viewDate` can carry any day-of-month (opening the
  // popover seeds it from parseIsoDate(selectedDate), not the 1st) — keying
  // on the object itself would rebuild the grid on a day-only change that
  // can never affect its output.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cells = useMemo(() => buildMonthGrid(viewDate), [year, month]);

  // Ranged to this one visible month rather than every trading day ever —
  // see useTradingDaysInRange's own comment.
  const monthStart = todayIsoDate(new Date(year, month, 1));
  const monthEnd = todayIsoDate(new Date(year, month + 1, 0));
  const rangeQuery = useTradingDaysInRange(monthStart, monthEnd);
  const tradingDates = useMemo(
    () => new Set((rangeQuery.data ?? []).map((row) => row.trade_date)),
    [rangeQuery.data],
  );

  const shownDate = selectedDate ?? liveDate;
  const todayDate = todayIsoDate();

  const triggerLabel = shownDate
    ? new Intl.DateTimeFormat("he-IL", { dateStyle: "medium" }).format(parseIsoDate(shownDate))
    : "בחר תאריך";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="יום מסחר מוצג — בחר תאריך"
        className="flex h-9 w-full items-center gap-2 rounded-md bg-surface-muted px-2.5 text-xs font-semibold text-ink ring-1 ring-inset ring-border-strong transition-colors duration-200 hover:bg-surface hover:ring-ink-subtle"
      >
        <Icon name="calendar" className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
        <span className="flex-1 truncate text-start">{triggerLabel}</span>
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="בחירת יום מסחר"
            style={{ position: "fixed", top: position.top, right: position.right }}
            className="z-50 w-[19rem] overflow-hidden rounded-xl border border-border bg-surface p-3 text-ink shadow-overlay"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setViewDate(new Date(year, month - 1, 1))}
                aria-label="חודש קודם"
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                {/* chevronStart points visually right (inline-start); a 180°
                    spin makes it point left — inline-end, i.e. "forward" —
                    the same technique globals.css's accordion chevron uses. */}
                <Icon name="chevronStart" className="h-4 w-4 rotate-180" />
              </button>
              <button
                type="button"
                onClick={() => setViewDate(parseIsoDate(liveDate ?? todayDate))}
                className="font-display text-sm text-ink hover:text-accent"
              >
                {MONTH_YEAR_FORMAT.format(viewDate)}
              </button>
              <button
                type="button"
                onClick={() => setViewDate(new Date(year, month + 1, 1))}
                aria-label="חודש הבא"
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <Icon name="chevronStart" className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-1 text-center">
              {WEEKDAY_LABELS.map((label, i) => (
                <span key={i} aria-hidden className="text-[11px] font-semibold text-ink-subtle">
                  {label}
                </span>
              ))}

              {cells.map((cellDate) => {
                const iso = todayIsoDate(cellDate);
                const inMonth = cellDate.getMonth() === month;
                const hasTradingDay = tradingDates.has(iso);
                const isLiveDay = iso === liveDate;
                const isShown = iso === shownDate;
                const isToday = iso === todayDate;

                if (!inMonth) {
                  // Grid filler only — see buildMonthGrid's comment on why
                  // these exist at all. Not a button: nothing to click, and
                  // an unlabelled disabled control is worse than a plain span.
                  return (
                    <span key={iso} aria-hidden className="py-1.5 text-xs text-ink-subtle/40">
                      {cellDate.getDate()}
                    </span>
                  );
                }

                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => {
                      onSelect(iso);
                      setOpen(false);
                    }}
                    aria-label={
                      CELL_LABEL_FORMAT.format(cellDate) +
                      (hasTradingDay ? " — קיים יום מסחר" : "") +
                      (isLiveDay ? " — היום הפעיל" : "")
                    }
                    aria-current={isShown ? "date" : undefined}
                    className={`relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-150 ${
                      isShown
                        ? "bg-accent text-accent-ink"
                        : isLiveDay
                          ? "text-accent ring-2 ring-inset ring-accent"
                          : isToday
                            ? "text-ink ring-1 ring-inset ring-border-strong"
                            : hasTradingDay
                              ? "bg-surface-muted text-ink hover:bg-accent-soft"
                              : "text-ink-muted hover:bg-surface-muted"
                    }`}
                  >
                    {cellDate.getDate()}
                    {/* The highlight the user asked for: a small dot marking
                        any day with a trading day, distinct from the ring
                        that marks the live one and the fill that marks
                        whichever day is currently shown. Omitted when the
                        cell is already filled solid (isShown) — a dot on top
                        of a solid disc doesn't read as anything. */}
                    {hasTradingDay && !isShown && (
                      <span
                        aria-hidden
                        className={`absolute bottom-0.5 h-1 w-1 rounded-full ${
                          isLiveDay ? "bg-accent" : "bg-brass"
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
