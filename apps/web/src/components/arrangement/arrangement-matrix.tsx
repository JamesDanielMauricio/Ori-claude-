import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Icon } from "@/components/ui/icon";

import { formatPallets } from "./board-data";
import {
  cellTarget,
  flattenMatrixRows,
  type Matrix,
  type MatrixProductRow,
  type MatrixRow,
} from "./matrix-data";

// The arrangement matrix: products down, customers across, one editable cell
// where they meet. See matrix-data.ts for the shape of the thing and for why
// a multi-grower product row is a read-only sum.
//
// ---------------------------------------------------------------------------
// Why this is a hand-rolled grid and not the shared <TableContainer>
// ---------------------------------------------------------------------------
// Three requirements the ordinary table component cannot meet at once:
//
//   1. FROZEN PANES. Three leading columns (product, in stock, available) and
//      two trailing ones (ordered, allocated) stay put while the customers
//      between them scroll horizontally, and the header row stays put while
//      the products scroll vertically. That needs per-cell `position: sticky`
//      with hard-coded offsets, which in turn needs fixed column widths —
//      hence `table-fixed` plus an explicit <colgroup>. The page is RTL, so
//      the LEADING columns pin to `right` and the trailing ones to `left`.
//
//   2. SCALE. A real trading day here is ~600 pick lines (one grower alone
//      carries the whole bulk catalog), so the full grid is ~600 rows ×
//      ~20 customers ≈ 12,000 cells. Mounting an <input> in each is several
//      seconds of layout and makes scrolling stutter, so only the rows near
//      the viewport are rendered and the rest are two spacer rows holding the
//      scrollbar at the right length. That is also what keeps the render
//      cheap enough that no row memoisation is needed: a keystroke re-renders
//      ~25 rows, not 600.
//
//   3. KEYBOARD ENTRY. Arrow keys move between cells, Enter commits and drops
//      down a row — the spreadsheet behaviour this screen replaces.
// ---------------------------------------------------------------------------

/** One cell's write, addressed to the grower pick line it comes off. */
export interface MatrixWrite {
  pickLineId: string;
  customerId: string;
  /** Zero means "remove the allocation" — see the route's onCommit. */
  quantity: number;
  recordId: string | null;
  price: number | null;
  priceType: string | null;
}

// Fixed geometry. Every sticky offset below is a running sum of these, and
// the virtualiser multiplies ROW_H by an index, so they have to be constants
// rather than measured — a row whose height depended on its content would
// make both the offsets and the scroll maths wrong.
const ROW_H = 64;
// Sized to the header's own worst case, not picked round: a customer name
// wraps at most 4 lines (`line-clamp-4` below) at text-[11px] leading-[1.25],
// i.e. 4 × 13.75px = 55px, plus the cells' pb-3 (12px) = 67px, plus a small
// buffer against font-metric rounding. It used to be 112 — measured against
// the actual rendered header, that left 86px of blank space above a
// one-line name like "Customer 01" (76% of the row), which is what made the
// header look broken and made the already-thin scrollbar thumb (necessarily
// tiny — see ArrangementMatrix's own comment on why, below) look lost inside
// an oversized empty band above it.
const HEADER_H = 80;
const W_PRODUCT = 232;
const W_STOCK = 88;
const W_AVAILABLE = 80;
const W_CUSTOMER = 124;
const W_ORDERED = 92;
const W_ALLOCATED = 92;
/** Total width of the pinned leading (right, in RTL) pane. */
const LEAD_PANE = W_PRODUCT + W_STOCK + W_AVAILABLE;
/** Total width of the pinned trailing (left, in RTL) pane. */
const TRAIL_PANE = W_ORDERED + W_ALLOCATED;
/** Rows rendered beyond each edge of the viewport, so a flick doesn't blank. */
const OVERSCAN = 6;

// BOTH scrollbars here are custom-drawn, replacing the native ones outright
// — see the scrollport's own comment below for the two things that ruled out
// styling the native ones instead. A native VERTICAL thumb, sized strictly
// proportionally to real content (~39,000px for today's ~600-row catalog
// against a ~700px viewport), is correctly only a few pixels tall — too
// small to see or grab — so browsers enforce their own minimum; we need the
// same floor explicitly since we're drawing it ourselves. 28/40px are
// comfortably clickable without, on a short list or narrow table, dominating
// the track.
const MIN_THUMB_H = 28;
const MIN_THUMB_W = 40;
/** Gap kept between a custom thumb and the card's own rounded corners. */
const THUMB_INSET = 6;
// Reserved at the corner where both thumbs would otherwise land — the
// vertical thumb's home is `left: 4` + its own w-2 (8px), and the horizontal
// thumb's is `bottom: 4` + its h-2, so without this each track would let its
// thumb slide the last few pixels half-underneath the other one. Applied to
// only ONE end of each track (the end nearest the other thumb's fixed
// edge — see `measure()`), and only when the OTHER axis actually has
// something to scroll; a table that only overflows vertically still gets
// the full-height vertical track a plain scrollbar would have.
const CORNER_GUTTER = 18;

// Layering, lowest to highest: an ordinary cell, a cell in a frozen column, a
// header cell, and the four corners that are both. Without this the frozen
// columns scroll *over* the header, or the header scrolls over nothing.
const Z_STICKY_COL = "z-20";
const Z_HEADER = "z-30";
const Z_CORNER = "z-40";

const CELL_BORDER = "border-b border-e border-border/70";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Where a cell is, plus which row that was — see `resolve`. */
interface CellAddress {
  row: number;
  col: number;
  key: string;
}

const BLANK_CELL = {
  ordered: 0,
  allocated: 0,
  recordId: null,
  price: null,
  priceType: null,
} as const;

/** "" for nothing, so an empty box reads as empty rather than as a zero. */
function palletsOrBlank(value: number): string {
  return value > 0 ? formatPallets(value) : "";
}

export function ArrangementMatrix({
  matrix,
  expanded,
  onToggle,
  editable,
  onCommit,
}: {
  matrix: Matrix;
  expanded: ReadonlySet<string>;
  onToggle: (varietyId: string) => void;
  editable: boolean;
  /** Resolves to whether the write landed; a refusal reverts the cell. */
  onCommit: (write: MatrixWrite) => Promise<boolean>;
}) {
  const { columns } = matrix;
  const rows = flattenMatrixRows(matrix.rows, expanded);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The custom vertical thumb's own geometry — null when the list fits
  // without scrolling at all, in which case nothing is drawn. Kept as state
  // (not a ref) because it has to repaint the thumb; kept separate from
  // `range` even though both are written by the same `measure()` below,
  // because a search that shortens the list changes this without changing
  // which rows are rendered, and vice versa for a plain scroll.
  const [thumbGeo, setThumbGeo] = useState<{
    top: number;
    height: number;
    /** 0–100, for the thumb's `aria-valuenow` — how far down the list this is. */
    percent: number;
  } | null>(null);
  // Same idea, horizontal — the columns are ~1800px wide against a ~1260px
  // viewport, so this table needs a horizontal scrollbar too, and it gets
  // the identical custom treatment for the identical reason (see the
  // scrollport's own comment below). `left`/`width` rather than `right`, so
  // the maths is plain physical pixels-from-the-left regardless of the
  // page's RTL direction — only the PROGRESS calculation (in `measure`
  // below) has to account for RTL's negative `scrollLeft` convention.
  const [hThumbGeo, setHThumbGeo] = useState<{
    left: number;
    width: number;
    percent: number;
  } | null>(null);
  // Drag state for both thumbs, as refs rather than state: they change on
  // every pointermove, and none of those frames need to trigger a React
  // render — dragging only ever ends up mutating `element.scrollTop` /
  // `scrollLeft` directly (see the two handlePointerMove functions), and the
  // scroll listener already in place below is what turns that back into
  // `range`/`thumbGeo`/`hThumbGeo` updates.
  const dragRef = useRef<{
    startY: number;
    startScrollTop: number;
    scrollable: number;
    trackHeight: number;
  } | null>(null);
  const hDragRef = useRef<{
    startX: number;
    startScrollLeft: number;
    scrollable: number;
    trackWidth: number;
  } | null>(null);
  // The focused cell and the cell being typed into, each addressed by index
  // into `rows` × `columns` — indices because navigation is arithmetic on
  // them and because the virtualiser already addresses rows that way.
  //
  // Both carry the row's KEY as well, and that is not redundancy. An index
  // stops meaning the same row the instant one is expanded (which splices
  // grower rows in beneath it) or the search narrows the list, and a stale
  // address would quietly point the arrow keys, and a pending write, at
  // whichever row has slid into that slot. `resolve` below is where that is
  // caught.
  const [active, setActive] = useState<CellAddress | null>(null);
  // Only ever one draft: a cell commits when it loses focus, so a second one
  // cannot begin before the first has ended.
  const [draft, setDraft] = useState<(CellAddress & { value: string }) | null>(null);
  const [range, setRange] = useState({ start: 0, end: 40 });

  const rowCount = rows.length;

  /** An address, or null once the row it named is no longer at that index. */
  function resolve<T extends CellAddress>(address: T | null): T | null {
    if (!address) return null;
    return rows[address.row]?.key === address.key ? address : null;
  }

  const activeCell = resolve(active);
  const draftCell = resolve(draft);

  // ---- virtualisation --------------------------------------------------
  // Measured off the scroll container rather than the window: the grid owns
  // its own scrollport (that is what makes `position: sticky` work without
  // guessing the page's offset), so the page's scroll position is irrelevant
  // here. Row `i` sits at HEADER_H + i * ROW_H in flow, and the sticky header
  // always covers the top HEADER_H of the viewport, so the first row visible
  // *below* the header is simply scrollTop / ROW_H.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const first = Math.floor(element.scrollTop / ROW_H);
      const visible = Math.ceil(Math.max(0, element.clientHeight - HEADER_H) / ROW_H);
      const start = Math.max(0, first - OVERSCAN);
      const end = Math.min(rowCount, first + visible + OVERSCAN);
      // Same-range guard: a scroll event fires per frame, and re-rendering
      // the grid for a range it already has is the one thing that would make
      // scrolling this cheap grid expensive again.
      setRange((current) =>
        current.start === start && current.end === end ? current : { start, end },
      );

      // Both thumbs, computed off the SAME scroll tick — one listener
      // driving both, rather than a second effect duplicating it.
      const scrollable = element.scrollHeight - element.clientHeight;
      const hScrollable = element.scrollWidth - element.clientWidth;

      if (scrollable <= 0) {
        // Nothing to scroll: no thumb, the same way a native scrollbar
        // simply isn't drawn when content already fits.
        setThumbGeo((current) => (current === null ? current : null));
      } else {
        const trackHeight = Math.max(
          0,
          element.clientHeight - THUMB_INSET - (hScrollable > 0 ? CORNER_GUTTER : THUMB_INSET),
        );
        const proportional = trackHeight * (element.clientHeight / element.scrollHeight);
        const height = clamp(proportional, MIN_THUMB_H, trackHeight);
        const top = THUMB_INSET + (element.scrollTop / scrollable) * (trackHeight - height);
        const percent = Math.round((element.scrollTop / scrollable) * 100);
        setThumbGeo((current) =>
          current && current.top === top && current.height === height && current.percent === percent
            ? current
            : { top, height, percent },
        );
      }

      // The horizontal thumb, same tick, same reasoning. The one real
      // difference is RTL's `scrollLeft`: 0 is the START (unscrolled — the
      // rightmost columns, since this page reads right to left) and it goes
      // NEGATIVE down to `-scrollable` at the far END, so `progress` has to
      // be built from `-scrollLeft` rather than read off it directly the
      // way `scrollTop` is above.
      if (hScrollable <= 0) {
        setHThumbGeo((current) => (current === null ? current : null));
      } else {
        // The vertical thumb's gutter is at the LEFT (its own home edge),
        // not the right, so only the left bound of this track moves.
        const leftMin = scrollable > 0 ? CORNER_GUTTER : THUMB_INSET;
        const leftMax = element.clientWidth - THUMB_INSET;
        const trackWidth = Math.max(0, leftMax - leftMin);
        const proportional = trackWidth * (element.clientWidth / element.scrollWidth);
        const width = clamp(proportional, MIN_THUMB_W, trackWidth);
        const progress = -element.scrollLeft / hScrollable;
        // 1 - progress: at progress 0 (start, unscrolled) the thumb sits at
        // the FAR end of its own travel — which in this RTL track is the
        // RIGHT side, i.e. the larger `left` value — and eases toward
        // `leftMin` as progress reaches 1.
        const left = leftMin + (1 - progress) * (trackWidth - width);
        const percent = Math.round(progress * 100);
        setHThumbGeo((current) =>
          current && current.left === left && current.width === width && current.percent === percent
            ? current
            : { left, width, percent },
        );
      }
    };
    // Coalesced into a frame: scroll fires far more often than the browser
    // paints, and each un-throttled handler would queue its own React render.
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    element.addEventListener("scroll", onScroll, { passive: true });
    // The visible row count changes with the window, not only with scrolling.
    const observer = new ResizeObserver(onScroll);
    observer.observe(element);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [rowCount]);

  // Re-clamped on every render rather than only in the effect above: a search
  // that shortens the list must not paint rows past its end for the frame
  // before the effect re-runs.
  const start = clamp(range.start, 0, Math.max(0, rowCount - 1));
  const end = clamp(range.end, start, rowCount);
  const visibleRows = rows.slice(start, end);
  const topPad = start * ROW_H;
  const bottomPad = Math.max(0, (rowCount - end) * ROW_H);

  // ---- focus -----------------------------------------------------------
  // Focus is applied here rather than at the call site because the target
  // cell may not be mounted yet: moving to a row outside the rendered window
  // scrolls first, and only once `range` has caught up does the input exist
  // to receive focus. Hence `range` in the dependencies — this effect is the
  // second half of every navigation.
  useEffect(() => {
    if (!activeCell) return;
    const input = scrollRef.current?.querySelector<HTMLInputElement>(
      `input[data-cell="${activeCell.row}-${activeCell.col}"]`,
    );
    if (input && document.activeElement !== input) {
      input.focus();
      input.select();
    }
  }, [activeCell, range]);

  // ---- the custom thumb --------------------------------------------------
  // Dragging never touches React state directly: it writes `scrollTop` on
  // the real element, and the `scroll` listener the virtualiser already
  // owns (above) is what turns that back into a re-measured `range` and
  // `thumbGeo` — one path for "the list moved," whether a wheel, a keypress
  // or this drag caused it.
  function handleThumbPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const element = scrollRef.current;
    if (!element || !thumbGeo) return;
    // Stops the pointer-down from also landing as a text-selection drag or
    // stealing focus from whatever cell was being edited.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Mirrors `measure()`'s own track-height formula exactly — the corner
    // gutter has to match what's actually rendered, or the last few pixels
    // of a drag would move the thumb faster or slower than the cursor.
    const trackHeightFull =
      element.clientHeight - THUMB_INSET - (hThumbGeo ? CORNER_GUTTER : THUMB_INSET);
    dragRef.current = {
      startY: event.clientY,
      startScrollTop: element.scrollTop,
      scrollable: element.scrollHeight - element.clientHeight,
      // The distance the thumb's OWN top can travel — not the full track —
      // which is what makes a pixel of mouse movement equal a pixel of
      // thumb movement instead of overshooting by the thumb's own height.
      trackHeight: Math.max(0, trackHeightFull) - thumbGeo.height,
    };
  }

  function handleThumbPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const element = scrollRef.current;
    if (!drag || !element || drag.trackHeight <= 0) return;
    const dy = event.clientY - drag.startY;
    const scrollDelta = (dy / drag.trackHeight) * drag.scrollable;
    element.scrollTop = clamp(drag.startScrollTop + scrollDelta, 0, drag.scrollable);
  }

  function handleThumbPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  // Same shape as the three above, mirrored onto `scrollLeft`. The one
  // difference that isn't just s/Top/Left/ — the clamp range: RTL's
  // `scrollLeft` runs `-scrollable..0`, not `0..scrollable`.
  function handleHThumbPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const element = scrollRef.current;
    if (!element || !hThumbGeo) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Mirrors `measure()`'s own track-width formula — see the vertical
    // handler above for why this has to match exactly.
    const leftMin = thumbGeo ? CORNER_GUTTER : THUMB_INSET;
    const trackWidthFull = element.clientWidth - THUMB_INSET - leftMin;
    hDragRef.current = {
      startX: event.clientX,
      startScrollLeft: element.scrollLeft,
      scrollable: element.scrollWidth - element.clientWidth,
      trackWidth: Math.max(0, trackWidthFull) - hThumbGeo.width,
    };
  }

  function handleHThumbPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = hDragRef.current;
    const element = scrollRef.current;
    if (!drag || !element || drag.trackWidth <= 0) return;
    const dx = event.clientX - drag.startX;
    const scrollDelta = (dx / drag.trackWidth) * drag.scrollable;
    element.scrollLeft = clamp(drag.startScrollLeft + scrollDelta, -drag.scrollable, 0);
  }

  function handleHThumbPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!hDragRef.current) return;
    hDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  // Brings a row into view *under* the sticky header, then marks it active.
  // The horizontal half is left to the browser: the inputs carry scroll
  // margins matching the frozen panes, so the automatic scroll-into-view that
  // comes with `.focus()` already clears them.
  function focusCell(row: number, col: number) {
    const element = scrollRef.current;
    if (element) {
      const maxScroll = row * ROW_H;
      const minScroll = HEADER_H + (row + 1) * ROW_H - element.clientHeight;
      if (element.scrollTop > maxScroll) element.scrollTop = maxScroll;
      else if (element.scrollTop < minScroll) element.scrollTop = minScroll;
    }
    const key = rows[row]?.key;
    if (key) setActive({ row, col, key });
  }

  /**
   * The next row in `direction` whose cell in this column can be typed into.
   *
   * Read-only rows are stepped over rather than landed on: a collapsed
   * multi-grower product row has no input to focus, and most rows in a long
   * catalog are exactly that, so stopping on one would make ArrowDown appear
   * to do nothing.
   */
  function nextEditableRow(from: number, direction: 1 | -1, col: number): number | null {
    for (let index = from; index >= 0 && index < rows.length; index += direction) {
      const candidate = rows[index];
      if (candidate && cellTarget(candidate, col, columns)) return index;
    }
    return null;
  }

  // ---- committing ------------------------------------------------------
  // Called on blur, on Enter and before every navigation keystroke. Clearing
  // the draft first is what makes a refusal self-correcting: the input falls
  // straight back to the server's own number, so a rejected quantity can
  // never sit in a box next to a total that disagrees with it.
  async function commitDraft() {
    // The resolved draft, so a write can never land on a row that has since
    // moved out from under the index it was typed at.
    const pending = draftCell;
    setDraft(null);
    if (!pending) return;

    const row = rows[pending.row];
    if (!row) return;
    const target = cellTarget(row, pending.col, columns);
    if (!target) return;

    // A decimal comma is what a Hebrew keyboard produces on the numpad, and
    // half-pallets (5.5) are routine — so accept both separators rather than
    // silently discarding the entry.
    const raw = pending.value.trim().replace(",", ".");
    // Emptying a cell means "nothing is arranged here", which is a deletion,
    // not a no-op. The route turns a zero into delete_arrangement_record.
    const next = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(next) || next < 0) return;
    if (next === target.current) return;

    await onCommit({
      pickLineId: target.pickLineId,
      customerId: target.customerId,
      quantity: next,
      recordId: target.recordId,
      price: target.price,
      priceType: target.priceType,
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    const input = event.currentTarget;

    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
      return;
    }

    if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      void commitDraft();
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const next = nextEditableRow(row + direction, direction, col);
      if (next !== null) focusCell(next, col);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      // The grid runs right-to-left while the number inside the box runs
      // left-to-right (dir="ltr" below, so digits read normally). Leaving the
      // box therefore follows the VISUAL edge the caret is against: pressing
      // right at the right-hand end of the text steps to the column visually
      // to the right, which in an RTL grid is the previous one.
      const step = event.key === "ArrowLeft" ? 1 : -1;
      const atEdge =
        step === 1
          ? input.selectionStart === 0 && input.selectionEnd === 0
          : input.selectionStart === input.value.length &&
            input.selectionEnd === input.value.length;
      // Not yet at the edge: let the caret move through the text the way it
      // does in any other input.
      if (!atEdge) return;

      const nextCol = col + step;
      if (nextCol < 0 || nextCol >= columns.length) return;
      event.preventDefault();
      void commitDraft();
      focusCell(row, nextCol);
    }
  }

  const totalColumns = 3 + columns.length + 2;
  const tableWidth = LEAD_PANE + columns.length * W_CUSTOMER + TRAIL_PANE;

  return (
    // Outer, non-scrolling wrapper. Its only job is to anchor the custom
    // thumb below via `position: absolute` OUTSIDE the scrolling box, so the
    // thumb doesn't itself scroll away with the table it represents — it has
    // to be a sibling of the scrollport, not a child of it. No visual
    // styling of its own: it sizes itself exactly to the card it wraps.
    <div className="relative">
      <div
        ref={scrollRef}
        id="arrangement-matrix-scrollport"
        // ONE scrollport, both axes — and both native scrollbars replaced by
        // the custom `thumbGeo`/`hThumbGeo` pair below. Two things ruled out
        // styling or partially hiding the native ones instead of fully
        // replacing them:
        //
        //   1. VERTICAL SIZE. A real ~600-row catalog gives the browser an
        //      actual scrollHeight of header + rowCount × ROW_H (≈39,000px
        //      against a ~700px viewport), so a strictly proportional
        //      native thumb is only a few px tall — accurate, but too small
        //      to see or grab. Browsers cover for this with their own
        //      enforced minimum against a full-height track, which reads as
        //      one long bar with a sliver lost inside it.
        //
        //   2. NO CLEAN WAY TO HIDE JUST ONE AXIS. `scrollbar-width` and
        //      `::-webkit-scrollbar` both apply to the whole element, not
        //      per axis, and WebKit's `::-webkit-scrollbar:vertical` (tried
        //      first) is Chromium/Safari-only — Firefox has no equivalent,
        //      so it kept showing its own native vertical bar right next to
        //      the custom one. Splitting vertical and horizontal onto two
        //      NESTED scroll containers (tried second, to route each axis's
        //      hiding to its own element) fixed that but broke worse: the
        //      inner container had to be exactly as tall as the whole table
        //      (~39,000px) for the outer one to be what actually scrolls it,
        //      and a native scrollbar renders at ITS OWN box's edge — so the
        //      inner container's horizontal scrollbar rendered at the
        //      bottom of THAT, tens of thousands of pixels below the
        //      visible viewport, not at the bottom of the card. Structurally
        //      unfixable without abandoning native scroll machinery for at
        //      least one axis, so it now abandons it for both — the same
        //      `thumbGeo` pattern extended to `hThumbGeo`, sized to
        //      MIN_THUMB_H / MIN_THUMB_W, positioned as two absolutely-
        //      placed siblings of this div (below) rather than inside it.
        //
        // The height is a subtraction rather than a percentage because the
        // backoffice <main> is a stretched flex child with no definite
        // height for a percentage to resolve against; the floor keeps it
        // usable on a short window.
        style={{ height: "calc(100dvh - 15rem)", minHeight: "22rem", scrollbarWidth: "none" }}
        className="animate-rise-in relative overflow-auto rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70 [&::-webkit-scrollbar]:hidden"
      >
        <table
          className="table-fixed border-collapse text-sm"
          style={{ width: tableWidth }}
          // Announced as a grid rather than a plain table, because arrow keys
          // move a cursor through it — a screen reader user meeting the normal
          // table reading mode here would be fighting the key handling above.
          role="grid"
        >
          <colgroup>
            <col style={{ width: W_PRODUCT }} />
            <col style={{ width: W_STOCK }} />
            <col style={{ width: W_AVAILABLE }} />
            {columns.map((column) => (
              <col key={column.customerId} style={{ width: W_CUSTOMER }} />
            ))}
            <col style={{ width: W_ORDERED }} />
            <col style={{ width: W_ALLOCATED }} />
          </colgroup>

          {/* Sticky is declared per <th> rather than on the <thead>: a sticky
            thead is honoured inconsistently across browsers, while a sticky
            cell is not — and the corners need a second axis anyway. */}
          <thead>
            <tr style={{ height: HEADER_H }}>
              <th
                scope="col"
                style={{ right: 0 }}
                className={`sticky top-0 ${Z_CORNER} ${CELL_BORDER} bg-surface-muted px-3 text-start align-bottom pb-3 text-[11px] font-semibold tracking-[0.06em] text-ink-subtle`}
              >
                מוצרים
              </th>
              <th
                scope="col"
                style={{ right: W_PRODUCT }}
                className={`sticky top-0 ${Z_CORNER} ${CELL_BORDER} bg-surface-muted px-2 align-bottom pb-3 text-[11px] font-semibold leading-tight text-ink-subtle`}
              >
                סה״כ במלאי
              </th>
              <th
                scope="col"
                style={{ right: W_PRODUCT + W_STOCK }}
                className={`sticky top-0 ${Z_CORNER} ${CELL_BORDER} bg-surface-muted px-2 align-bottom pb-3 text-[11px] font-semibold leading-tight text-ink-subtle`}
              >
                זמין
              </th>

              {columns.map((column) => (
                <th
                  key={column.customerId}
                  scope="col"
                  className={`sticky top-0 ${Z_HEADER} ${CELL_BORDER} bg-surface-muted px-1.5 align-bottom pb-3 text-[11px] font-semibold leading-[1.25] text-ink-muted`}
                >
                  {/* Customer names here are full company names ("אחים כבביה
                    שיווק פירות וירקות בע״מ"). Clamped to four lines so one
                    long name cannot set the height of every header cell, with
                    the full name on hover. */}
                  <span className="line-clamp-4 break-words" title={column.customerName}>
                    {column.customerName}
                  </span>
                </th>
              ))}

              <th
                scope="col"
                style={{ left: W_ALLOCATED }}
                className={`sticky top-0 ${Z_CORNER} ${CELL_BORDER} bg-surface-muted px-2 align-bottom pb-3 text-[11px] font-semibold leading-tight text-ink-subtle`}
              >
                סה״כ הוזמן
              </th>
              <th
                scope="col"
                style={{ left: 0 }}
                className={`sticky top-0 ${Z_CORNER} ${CELL_BORDER} bg-surface-muted px-2 align-bottom pb-3 text-[11px] font-semibold leading-tight text-ink-subtle`}
              >
                סה״כ חולק
              </th>
            </tr>
          </thead>

          <tbody>
            {/* The two spacers hold the scrollbar at the height the full list
              would occupy, so scrolling is proportional to the whole catalog
              even though only `visibleRows` exist in the DOM. */}
            {topPad > 0 && (
              <tr aria-hidden style={{ height: topPad }}>
                <td colSpan={totalColumns} className="border-0 p-0" />
              </tr>
            )}

            {visibleRows.map((row, offset) => {
              const rowIndex = start + offset;
              return (
                <MatrixRowCells
                  key={row.key}
                  row={row}
                  rowIndex={rowIndex}
                  columns={columns}
                  expanded={row.kind === "product" && expanded.has(row.varietyId)}
                  onToggle={onToggle}
                  editable={editable}
                  active={activeCell}
                  draft={draftCell}
                  onDraft={setDraft}
                  onCommit={() => void commitDraft()}
                  onKeyDown={handleKeyDown}
                  onFocusCell={setActive}
                />
              );
            })}

            {bottomPad > 0 && (
              <tr aria-hidden style={{ height: bottomPad }}>
                <td colSpan={totalColumns} className="border-0 p-0" />
              </tr>
            )}
          </tbody>
        </table>

        {rowCount === 0 && (
          <p className="px-6 py-10 text-center text-sm text-ink-muted">
            אין מוצרים להצגה — נסה מונח חיפוש אחר.
          </p>
        )}
      </div>

      {/* The custom thumb — a sibling of the scrollport above, not a child of
          it, so scrolling the table never carries it away with the content.
          Absent entirely when the list already fits (`thumbGeo` null),
          matching a native scrollbar's own "nothing to show" behaviour. */}
      {thumbGeo && (
        <div
          role="scrollbar"
          aria-orientation="vertical"
          aria-controls="arrangement-matrix-scrollport"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={thumbGeo.percent}
          aria-label="גלילה אנכית"
          // The page is RTL, and every screenshot of this grid has shown the
          // browser's own vertical scrollbar landing on the left for exactly
          // that reason — matching it here is what makes this read as "the
          // scrollbar" rather than as a stray decoration.
          style={{ left: 4, top: thumbGeo.top, height: thumbGeo.height }}
          className="absolute w-2 cursor-grab touch-none rounded-full bg-border-strong/80 transition-colors duration-150 hover:bg-ink-subtle active:cursor-grabbing active:bg-ink-subtle"
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={handleThumbPointerUp}
        />
      )}

      {/* Same idea, horizontal — bottom edge instead of left, `width`
          instead of `height`. See `hThumbGeo`'s own comment for the RTL
          progress maths this position is built from. */}
      {hThumbGeo && (
        <div
          role="scrollbar"
          aria-orientation="horizontal"
          aria-controls="arrangement-matrix-scrollport"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={hThumbGeo.percent}
          aria-label="גלילה אופקית"
          style={{ bottom: 4, left: hThumbGeo.left, width: hThumbGeo.width }}
          className="absolute h-2 cursor-grab touch-none rounded-full bg-border-strong/80 transition-colors duration-150 hover:bg-ink-subtle active:cursor-grabbing active:bg-ink-subtle"
          onPointerDown={handleHThumbPointerDown}
          onPointerMove={handleHThumbPointerMove}
          onPointerUp={handleHThumbPointerUp}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------
// Deliberately not memoised. Virtualisation already caps this at ~25 mounted
// rows, so a keystroke re-renders a few hundred cells — a couple of
// milliseconds — and memoising would mean threading stable callbacks and a
// per-row equality function through for no measurable gain.
function MatrixRowCells({
  row,
  rowIndex,
  columns,
  expanded,
  onToggle,
  editable,
  active,
  draft,
  onDraft,
  onCommit,
  onKeyDown,
  onFocusCell,
}: {
  row: MatrixRow;
  rowIndex: number;
  columns: Matrix["columns"];
  expanded: boolean;
  onToggle: (varietyId: string) => void;
  editable: boolean;
  active: CellAddress | null;
  draft: (CellAddress & { value: string }) | null;
  onDraft: (draft: CellAddress & { value: string }) => void;
  onCommit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>, row: number, col: number) => void;
  onFocusCell: (cell: CellAddress) => void;
}) {
  const isProduct = row.kind === "product";
  const isActiveRow = active?.row === rowIndex;
  const label = isProduct ? row.varietyName : row.growerName;

  // A grower row is one lot inside the product above it, so it is tinted and
  // indented rather than drawn as a peer — the indent and the band are what
  // say "this belongs to the row above" once the header has scrolled away.
  //
  // Every fill here is fully OPAQUE, and that is load-bearing rather than a
  // style preference: the customer columns scroll UNDERNEATH the frozen
  // panes, so a translucent fill on a sticky cell lets them show through it
  // and the pinned totals end up striped with whatever is passing behind.
  const rowBase = isProduct ? "bg-surface" : "bg-surface-muted";
  // The focused row is traced in the frozen pane only. Tinting the customer
  // cells as well would put a third fill in play against the demand tint,
  // and demand is the one this screen exists to make visible.
  const stickyTint = isActiveRow ? "bg-accent-soft" : rowBase;

  return (
    <tr style={{ height: ROW_H }}>
      {/* -- frozen leading pane (pinned right, this page being RTL) -- */}
      <th
        scope="row"
        style={{ right: 0 }}
        className={`sticky ${Z_STICKY_COL} ${CELL_BORDER} ${stickyTint} px-2 text-start font-normal`}
      >
        <div className={`flex items-center gap-1.5 ${isProduct ? "" : "ps-5"}`}>
          {isProduct && row.expandable ? (
            <button
              type="button"
              onClick={() => onToggle(row.varietyId)}
              aria-expanded={expanded}
              aria-label={`${expanded ? "סגור" : "פתח"} מגדלים עבור ${row.varietyName}`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-muted ring-1 ring-inset ring-border-strong transition-colors duration-150 hover:bg-accent-soft hover:text-accent"
            >
              <Icon
                name="chevronDown"
                className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          ) : (
            // Keeps the label's start edge on one vertical line whether or
            // not a row has a chevron, so the column doesn't ripple.
            isProduct && <span aria-hidden className="h-6 w-6 shrink-0" />
          )}
          <span className="min-w-0">
            <span
              className={`line-clamp-2 break-words text-[13px] leading-[1.2] ${isProduct ? "font-semibold text-ink" : "text-ink-muted"}`}
              title={label}
            >
              {label}
            </span>
            {isProduct && row.familyName && (
              <span className="mt-0.5 block truncate text-[10.5px] leading-none text-ink-subtle">
                {row.familyName}
              </span>
            )}
          </span>
        </div>
      </th>

      <TotalCell
        value={formatPallets(row.inStock)}
        offset={{ right: W_PRODUCT }}
        tint={stickyTint}
      />
      <TotalCell
        value={formatPallets(row.available)}
        offset={{ right: W_PRODUCT + W_STOCK }}
        tint={stickyTint}
        // Negative available means the pick line is over-committed. The
        // server refuses to create that, so it can only appear when a
        // grower revises pallets_picked downwards after the fact — which is
        // precisely when the distributor needs to see it shouting.
        tone={row.available < 0 ? "danger" : row.available === 0 ? "muted" : "normal"}
      />

      {/* -- the customer cells -- */}
      {columns.map((column, colIndex) => {
        // `buildMatrix` gives every row a cell per column, so the fallback is
        // unreachable — it is here because the compiler cannot know that, and
        // an all-zero cell is a truthful thing to paint if it ever were.
        const cell = row.cells[colIndex] ?? BLANK_CELL;
        const target = cellTarget(row, colIndex, columns);
        const isDrafting = draft?.row === rowIndex && draft.col === colIndex;
        const value = isDrafting ? draft.value : palletsOrBlank(cell.allocated);
        // The highlight marks demand, not allocation: a tinted cell is one
        // where this customer asked for this product, which is where the
        // distributor's attention belongs. It runs down the expanded grower
        // rows too — the request is against the variety, so every lot of it
        // is a candidate for filling that request.
        const wanted = cell.ordered > 0;

        return (
          <td
            key={column.customerId}
            className={`${CELL_BORDER} px-1.5 ${wanted ? "bg-marked" : rowBase}`}
          >
            <div className="flex flex-col items-stretch gap-1">
              {/* The number above the box. Printed on product rows only:
                  what a customer ordered is a fact about the VARIETY, so
                  repeating it on each grower row underneath would read as a
                  per-grower request that nobody made. The non-breaking space
                  holds the box on one line either way. */}
              <span
                className={`block text-center text-[11px] leading-none ${wanted ? "font-bold text-marked-ink" : "text-ink-subtle"}`}
              >
                {isProduct ? formatPallets(cell.ordered) : " "}
              </span>

              {target && editable ? (
                <input
                  data-cell={`${rowIndex}-${colIndex}`}
                  type="text"
                  inputMode="decimal"
                  // Digits read left-to-right inside an RTL page — the same
                  // rule globals.css applies to every number input.
                  dir="ltr"
                  autoComplete="off"
                  aria-label={`${label} — ${column.customerName}`}
                  value={value}
                  // The frozen panes and the sticky header would otherwise
                  // hide a cell the browser has just scrolled to on focus.
                  // Scroll margins are the only way to tell it about them.
                  style={{
                    scrollMarginTop: HEADER_H + 8,
                    scrollMarginInlineStart: LEAD_PANE + 8,
                    scrollMarginInlineEnd: TRAIL_PANE + 8,
                  }}
                  className="h-7 w-full rounded-sm border border-border-strong bg-surface px-1 text-center text-[13px] font-semibold text-ink outline-none transition-colors duration-150 focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/30"
                  onFocus={(event) => {
                    onFocusCell({ row: rowIndex, col: colIndex, key: row.key });
                    // Type-to-replace, the way stepping onto a spreadsheet
                    // cell behaves.
                    event.currentTarget.select();
                  }}
                  onChange={(event) =>
                    onDraft({
                      row: rowIndex,
                      col: colIndex,
                      key: row.key,
                      value: event.target.value,
                    })
                  }
                  onKeyDown={(event) => onKeyDown(event, rowIndex, colIndex)}
                  onBlur={onCommit}
                />
              ) : (
                // Read-only: either a multi-grower product row (the sum of
                // the growers below, which cannot be written as one number)
                // or a day that is closed or being viewed in the past. The
                // dashed edge says "this is a total", not "this is disabled".
                <span className="flex h-7 w-full items-center justify-center rounded-sm border border-dashed border-border-strong bg-surface-muted/70 text-center text-[13px] font-semibold text-ink-muted">
                  {palletsOrBlank(cell.allocated)}
                </span>
              )}
            </div>
          </td>
        );
      })}

      {/* -- frozen trailing pane (pinned left) -- */}
      <TotalCell
        // A grower row has no demand of its own — the order was placed
        // against the product, not against one of its lots — so it shows a
        // dash rather than a zero, which would claim nobody wanted it.
        value={isProduct ? formatPallets(row.ordered) : "—"}
        offset={{ left: W_ALLOCATED }}
        tint={stickyTint}
        tone={isProduct ? "normal" : "muted"}
      />
      <TotalCell
        value={formatPallets(row.allocated)}
        offset={{ left: 0 }}
        tint={stickyTint}
        tone={row.allocated > 0 ? "accent" : "muted"}
      />
    </tr>
  );
}

const TONE_CLASS = {
  normal: "text-ink",
  muted: "text-ink-subtle",
  accent: "text-accent font-bold",
  danger: "text-danger font-bold",
} as const;

/** One pinned numeric column. */
function TotalCell({
  value,
  offset,
  tint,
  tone = "normal",
}: {
  value: string;
  offset: { right: number } | { left: number };
  tint: string;
  tone?: keyof typeof TONE_CLASS;
}) {
  return (
    <td
      style={offset}
      className={`sticky ${Z_STICKY_COL} ${CELL_BORDER} ${tint} px-2 text-center text-[13px] font-semibold ${TONE_CLASS[tone]}`}
    >
      {value}
    </td>
  );
}

export type { MatrixProductRow };
