import { flattenMatrixRows, type Matrix, type MatrixProductRow } from "./matrix-data";
import {
  LEAD_PANE,
  ROW_H,
  TRAIL_PANE,
  W_ALLOCATED,
  W_AVAILABLE,
  W_CUSTOMER,
  W_ORDERED,
  W_PRODUCT,
  W_STOCK,
  clamp,
} from "./matrix/geometry";
import { MatrixHeader } from "./matrix/header";
import { MatrixRowCells } from "./matrix/row";
import { MatrixScrollbars } from "./matrix/scrollbars";
import { useMatrixCursor, type MatrixWrite } from "./matrix/use-matrix-cursor";
import { useMatrixScroll } from "./matrix/use-matrix-scroll";

// The arrangement matrix: products down, customers across, one editable cell
// where they meet. See matrix-data.ts for the shape of the thing and for why
// a multi-grower product row is a read-only sum.
//
// ---------------------------------------------------------------------------
// Why this is a hand-rolled grid and not the shared <TableContainer>
// ---------------------------------------------------------------------------
// Three requirements the ordinary table component cannot meet at once:
//
//   1. FROZEN PANES. Three leading columns (product, in stock, ordered) and
//      two trailing ones (available, allocated) stay put while the customers
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
//
// This file is the composition; its parts live in ./matrix/ — the fixed
// geometry, the scroll + virtualisation hook, the custom scrollbars, the
// keyboard cursor, the header row and one product/grower row.
// ---------------------------------------------------------------------------

export type { MatrixWrite } from "./matrix/use-matrix-cursor";

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
  const rowCount = rows.length;

  // The scrollport, the window of rows actually mounted, and both custom
  // scrollbars' geometry — see useMatrixScroll.
  const { scrollRef, range, thumbGeo, hThumbGeo } = useMatrixScroll(rowCount);
  // The focused cell, the cell being typed into, and the spreadsheet keys —
  // see useMatrixCursor.
  const { activeCell, draftCell, setActive, setDraft, commitDraft, handleKeyDown } =
    useMatrixCursor({ rows, columns, scrollRef, range, onCommit });

  // Re-clamped on every render rather than only in useMatrixScroll's effect: a search
  // that shortens the list must not paint rows past its end for the frame
  // before the effect re-runs.
  const start = clamp(range.start, 0, Math.max(0, rowCount - 1));
  const end = clamp(range.end, start, rowCount);
  const visibleRows = rows.slice(start, end);
  const topPad = start * ROW_H;
  const bottomPad = Math.max(0, (rowCount - end) * ROW_H);

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
        //
        // `isolate` keeps the sticky cells' z-20…z-40 layering INSIDE this
        // box. Without it those z-indexes compete with the two thumbs below
        // (siblings, no z-index) and win: the frozen columns paint over the
        // horizontal thumb at either end of its travel, and over the vertical
        // thumb entirely, since its `left: 4` sits under the pinned סה״כ חולק
        // column. `animate-rise-in` used to provide this layer by accident —
        // a lingering transform is a stacking context — until its fill mode
        // became `backwards` (see globals.css), after which it only exists
        // for the 0.34s entrance.
        style={{ height: "calc(100dvh - 15rem)", minHeight: "22rem", scrollbarWidth: "none" }}
        className="animate-rise-in relative isolate overflow-auto rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70 [&::-webkit-scrollbar]:hidden"
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
            <col style={{ width: W_ORDERED }} />
            {columns.map((column) => (
              <col key={column.customerId} style={{ width: W_CUSTOMER }} />
            ))}
            <col style={{ width: W_AVAILABLE }} />
            <col style={{ width: W_ALLOCATED }} />
          </colgroup>

          <MatrixHeader columns={columns} />

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

      <MatrixScrollbars scrollRef={scrollRef} thumbGeo={thumbGeo} hThumbGeo={hThumbGeo} />
    </div>
  );
}

export type { MatrixProductRow };
