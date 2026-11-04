import type { KeyboardEvent } from "react";

import { Icon } from "@/components/ui/icon";
import { stripDecimal } from "@/lib/integer-input";

import { formatPallets } from "../board-data";
import { cellTarget, type Matrix, type MatrixRow } from "../matrix-data";

import {
  CELL_BORDER,
  HEADER_H,
  LEAD_PANE,
  ROW_H,
  TRAIL_PANE,
  W_ALLOCATED,
  W_PRODUCT,
  W_STOCK,
  Z_STICKY_COL,
} from "./geometry";
import type { CellAddress } from "./use-matrix-cursor";

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
              className={`line-clamp-2 break-words text-sm leading-[1.2] ${isProduct ? "font-semibold text-ink" : "text-ink-muted"}`}
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
        offset={{ right: W_PRODUCT }}
        tint={stickyTint}
      />
      <TotalCell
        // A grower row has no demand of its own — the order was placed
        // against the product, not against one of its lots — so it shows a
        // dash rather than a zero, which would claim nobody wanted it.
        value={isProduct ? formatPallets(row.ordered) : "—"}
        offset={{ right: W_PRODUCT + W_STOCK }}
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
                className={`block text-center text-xs leading-none ${wanted ? "font-bold text-marked-ink" : "text-ink-subtle"}`}
              >
                {isProduct ? formatPallets(cell.ordered) : " "}
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
                    scrollMarginInlineStart: LEAD_PANE + 8,
                    scrollMarginInlineEnd: TRAIL_PANE + 8,
                  }}
                  className="h-7 w-full rounded-sm border border-border-strong bg-surface px-1 text-center text-sm font-semibold text-ink outline-none transition-colors duration-150 focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/30"
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
                // the growers below, which cannot be written as one number)
                // or a day that is closed or being viewed in the past. The
                // dashed edge says "this is a total", not "this is disabled".
                <span className="flex h-7 w-full items-center justify-center rounded-sm border border-dashed border-border-strong bg-surface-muted/70 text-center text-sm font-semibold text-ink-muted">
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
