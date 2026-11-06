import type { KeyboardEvent } from "react";

import { CellPopover } from "@/components/reference-data/cell-popover";
import { Icon } from "@/components/ui/icon";
import { stripDecimal } from "@/lib/integer-input";

import { formatPallets } from "../board-data";
import { cellTarget, cellTone, type Matrix, type MatrixRow } from "../matrix-data";

import { CELL_TONE, UNSAVED_BOX, UNSAVED_TITLE } from "./cell-look";
import {
  CELL_BORDER,
  COMPACT_PRODUCT_BELOW,
  HEADER_H,
  ROW_H,
  TRAIL_PANE,
  W_ALLOCATED,
  W_ORDERED,
  W_STOCK,
  Z_STICKY_COL,
} from "./geometry";
import type { CellAddress } from "./use-matrix-cursor";

const BLANK_CELL = {
  ordered: 0,
  comment: null,
  allocated: 0,
  proposed: 0,
  recordId: null,
  price: null,
  priceType: null,
} as const;

/** "" for nothing, so an empty box reads as empty rather than as a zero. */
function palletsOrBlank(value: number): string {
  return value > 0 ? formatPallets(value) : "";
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------
// Deliberately not memoised. Virtualisation already caps this at ~25 mounted
// rows, so a keystroke re-renders a few hundred cells — a couple of
// milliseconds — and memoising would mean threading stable callbacks and a
// per-row equality function through for no measurable gain.
export function MatrixRowCells({
  row,
  rowIndex,
  columns,
  expanded,
  onToggle,
  productWidth,
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
  /** The products column's width this render — see productColumnWidth. */
  productWidth: number;
  editable: boolean;
  active: CellAddress | null;
  draft: (CellAddress & { value: string }) | null;
  onDraft: (draft: CellAddress & { value: string }) => void;
  onCommit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>, row: number, col: number) => void;
  onFocusCell: (cell: CellAddress) => void;
}) {
  const isProduct = row.kind === "product";
  const compact = productWidth < COMPACT_PRODUCT_BELOW;
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
  // cells as well would put yet another fill in play against the two that
  // carry meaning there (ordered, arranged), and those are what this screen
  // exists to make visible.
  const stickyTint = isActiveRow ? "bg-accent-soft" : rowBase;

  return (
    <tr style={{ height: ROW_H }}>
      {/* -- frozen leading pane (pinned right, this page being RTL) -- */}
      <th
        scope="row"
        style={{ right: 0 }}
        className={`sticky ${Z_STICKY_COL} ${CELL_BORDER} ${stickyTint} px-2 text-start font-normal`}
      >
        <div
          className={`flex items-center ${compact ? "gap-1" : "gap-1.5"} ${isProduct ? "" : compact ? "ps-3" : "ps-5"}`}
        >
          {isProduct && row.expandable ? (
            <button
              type="button"
              onClick={() => onToggle(row.varietyId)}
              aria-expanded={expanded}
              aria-label={`${expanded ? "סגור" : "פתח"} מגדלים עבור ${row.varietyName}`}
              className={`flex ${compact ? "h-5 w-5" : "h-6 w-6"} shrink-0 items-center justify-center rounded-md text-ink-muted ring-1 ring-inset ring-border-strong transition-colors duration-150 hover:bg-accent-soft hover:text-accent`}
            >
              <Icon
                name="chevronDown"
                className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          ) : (
            // Keeps the label's start edge on one vertical line whether or
            // not a row has a chevron, so the column doesn't ripple. Given
            // up in the compact column: most rows have no chevron, and there
            // the 30px it reserves on every one of them is a third of the
            // name's room.
            isProduct && !compact && <span aria-hidden className="h-6 w-6 shrink-0" />
          )}
          <span className="min-w-0">
            {/* Compact: a size smaller and a third line, which together fit
                a long name where the wide column's two lines would cut it —
                and still leave the family line inside the fixed row height
                (3 x 15px + 14px, against 64). */}
            <span
              className={`break-words ${compact ? "line-clamp-3 text-[13px] leading-[1.15]" : "line-clamp-2 text-sm leading-[1.2]"} ${isProduct ? "font-semibold text-ink" : "text-ink-muted"}`}
              title={label}
            >
              {label}
            </span>
            {isProduct && row.familyName && (
              <span className="mt-0.5 block truncate text-xs leading-none text-ink-subtle">
                {row.familyName}
              </span>
            )}
          </span>
        </div>
      </th>

      <TotalCell
        value={formatPallets(row.inStock)}
        offset={{ right: productWidth }}
        tint={stickyTint}
      />
      <TotalCell
        // A grower row has no demand of its own — the order was placed
        // against the product, not against one of its lots — so it shows a
        // dash rather than a zero, which would claim nobody wanted it.
        value={isProduct ? formatPallets(row.ordered) : "—"}
        offset={{ right: productWidth + W_STOCK }}
        tint={stickyTint}
        tone={isProduct ? "normal" : "muted"}
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
        // Three states, one colour each (see cellTone): untinted where the
        // customer asked for nothing, yellow where they ordered and nothing
        // is arranged yet — which is where the distributor's attention
        // belongs — and orange once the cell holds pallets. The yellow runs
        // down the expanded grower rows too: the request is against the
        // variety, so every lot of it is a candidate for filling it.
        const tone = CELL_TONE[cellTone(cell)];
        const wanted = cell.ordered > 0;

        return (
          <td key={column.customerId} className={`${CELL_BORDER} px-1.5 ${tone.fill ?? rowBase}`}>
            <div className="flex flex-col items-stretch gap-1">
              {/* The number above the box. Printed on product rows only:
                  what a customer ordered is a fact about the VARIETY, so
                  repeating it on each grower row underneath would read as a
                  per-grower request that nobody made. The non-breaking space
                  holds the box on one line either way. */}
              {/* A fixed height, with or without a note button on it: a line
                  that grew only where there is a note would push that one
                  cell's box out of line with the rest of its row. */}
              <span
                className={`flex h-5 items-center justify-center gap-1 text-xs leading-none ${tone.ink} ${wanted ? "font-bold" : ""}`}
              >
                {isProduct ? formatPallets(cell.ordered) : " "}
                {/* The customer's own note on this order line, when they
                    left one. On product rows only, beside the number it
                    qualifies and for the same reason that number is.

                    A button that opens the note, not a hover hint: a native
                    `title` takes a second or more to appear and cannot be
                    summoned at all on a touch screen, and a note here can
                    change what the right number is ("2 משטח" on an order for
                    one). It keeps the quiet look of the hint it replaced —
                    the same small outline icon, in the line's own ink — and
                    only its hit area is larger than it looks. */}
                {isProduct && cell.comment && (
                  <CellPopover
                    label={`הערת הלקוח — ${column.customerName}`}
                    panelClassName="w-64"
                    trigger={{
                      className:
                        "flex h-5 w-4 shrink-0 cursor-pointer items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-bright",
                      content: <Icon name="infoCircle" className="h-3 w-3" />,
                    }}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
                      {cell.comment}
                    </p>
                  </CellPopover>
                )}
              </span>

              {target && editable ? (
                <input
                  data-cell={`${rowIndex}-${colIndex}`}
                  type="text"
                  inputMode="numeric"
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
                    scrollMarginInlineStart: productWidth + W_STOCK + W_ORDERED + 8,
                    scrollMarginInlineEnd: TRAIL_PANE + 8,
                  }}
                  // Unsaved numbers keep their own look in the box as well:
                  // it is the only thing telling them from what is already
                  // in the day now that both can be typed over.
                  title={cell.proposed > 0 ? UNSAVED_TITLE : undefined}
                  className={`h-7 w-full rounded-sm border px-1 text-center text-sm font-semibold outline-none transition-colors duration-150 focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/30 ${
                    cell.proposed > 0 ? UNSAVED_BOX : "border-border-strong bg-surface text-ink"
                  }`}
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
                      value: stripDecimal(event.target.value),
                    })
                  }
                  onKeyDown={(event) => onKeyDown(event, rowIndex, colIndex)}
                  onBlur={onCommit}
                />
              ) : (
                // Read-only: either a multi-grower product row (the sum of
                // the growers below, which cannot be written as one number),
                // a day that is closed or being viewed in the past, or a
                // proposal in the middle of being saved. The dashed edge says
                // "this is a total", not "this is disabled".
                //
                // A sum with unsaved pallets in it takes the same accent as
                // the boxes they were typed or suggested into.
                <span
                  title={cell.proposed > 0 ? UNSAVED_TITLE : undefined}
                  className={`flex h-7 w-full items-center justify-center rounded-sm border text-center text-sm font-semibold ${
                    cell.proposed > 0
                      ? UNSAVED_BOX
                      : "border-dashed border-border-strong bg-surface-muted/70 text-ink-muted"
                  }`}
                >
                  {palletsOrBlank(cell.allocated)}
                </span>
              )}
            </div>
          </td>
        );
      })}

      {/* -- frozen trailing pane (pinned left) -- */}
      <TotalCell
        value={formatPallets(row.available)}
        offset={{ left: W_ALLOCATED }}
        tint={stickyTint}
        // Negative available means the pick line is over-committed. The
        // server refuses to create that, so it can only appear when a
        // grower revises pallets_picked downwards after the fact — which is
        // precisely when the distributor needs to see it shouting.
        tone={row.available < 0 ? "danger" : row.available === 0 ? "muted" : "normal"}
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
      className={`sticky ${Z_STICKY_COL} ${CELL_BORDER} ${tint} px-2 text-center text-sm font-semibold ${TONE_CLASS[tone]}`}
    >
      {value}
    </td>
  );
}
