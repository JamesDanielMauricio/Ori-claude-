import { useState } from "react";

import { StatusPill } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

import { formatPallets } from "./board-data";
import type { MatrixWrite } from "./arrangement-matrix";
import {
  cellTarget,
  parseMatrixQuantity,
  type CellTarget,
  type Matrix,
  type MatrixColumn,
  type MatrixGrowerRow,
  type MatrixProductRow,
  type MatrixRow,
} from "./matrix-data";

// The matrix's mobile presentation — a drill-down card list rather than the
// frozen-pane spreadsheet in arrangement-matrix.tsx. That grid is built for
// keyboard-driven desktop entry (fixed column widths, per-cell `position:
// sticky`, virtualisation); none of that translates to a touch screen, so
// this is a second, independent renderer over the SAME `Matrix` data rather
// than a responsive variant of the same markup. Mounted instead of the
// desktop grid below `lg` — see routes/backoffice/new-arrangement.tsx.
//
// The desktop grid's two axes (every product × every customer, always all
// visible at once) become one list you drill into: products down the page,
// collapsed by default, each opening to show that product's customers. A
// customer filter at the top narrows every opened card down to one customer
// instead of building a second, fully-transposed view to keep in sync with
// this one — a distributor working through one customer's whole order picks
// them here once, then opens each product that customer wants.
//
// No arrow-key cell-to-cell navigation, unlike the desktop grid: not
// meaningful for an on-screen keyboard. Enter/blur-to-commit is the one
// interaction carried over.
export function ArrangementMatrixMobile({
  matrix,
  expanded,
  onToggle,
  editable,
  onCommit,
}: {
  matrix: Matrix;
  // Shared with the desktop grid's own expand/collapse set (both keyed by
  // `varietyId`, only one of the two grids ever mounted at a time), even
  // though the meaning shifts slightly here: on desktop it reveals a
  // multi-grower row's per-grower breakdown; here it opens the whole card,
  // including single-grower products that the desktop grid never needs a
  // disclosure for at all.
  expanded: ReadonlySet<string>;
  onToggle: (varietyId: string) => void;
  editable: boolean;
  onCommit: (write: MatrixWrite) => Promise<boolean>;
}) {
  const { columns, rows } = matrix;
  const [customerId, setCustomerId] = useState("");

  // Indexed, not just filtered: `cellTarget` and `row.cells` both address a
  // customer by its position in the FULL `columns` array, so narrowing to one
  // customer must keep that original index rather than the filtered list's
  // own position — otherwise a filtered-down card would read (and write!)
  // the wrong customer's cell entirely.
  const entries = columns
    .map((column, index) => ({ column, index }))
    .filter((entry) => !customerId || entry.column.customerId === customerId);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2.5 rounded-xl bg-surface px-3.5 py-2.5 shadow-card ring-1 ring-inset ring-border-strong">
        <span className="shrink-0 text-xs font-semibold text-ink-muted">לקוח</span>
        <select
          aria-label="סנן לפי לקוח"
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-md bg-surface-muted px-2.5 text-sm text-ink ring-1 ring-inset ring-border outline-none transition-colors focus:ring-2 focus:ring-accent"
        >
          <option value="">כל הלקוחות</option>
          {columns.map((column) => (
            <option key={column.customerId} value={column.customerId}>
              {column.customerName}
            </option>
          ))}
        </select>
      </label>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-surface px-6 py-10 text-center text-sm text-ink-muted shadow-card ring-1 ring-inset ring-border/70">
          אין מוצרים להצגה — נסה מונח חיפוש אחר.
        </p>
      ) : (
        // Bounded and internally scrolling, the same fix applied to the
        // reference-data screens' RecordList (list-detail-layout.tsx): a full
        // catalog is a few hundred products, and letting the page itself grow
        // to hold every collapsed card would scroll the customer filter above
        // out of reach on exactly the search a distributor needs to keep
        // using. A plain block list, NOT `flex flex-col` — a flex column
        // with 600+ auto-basis children inside a height-capped, overflow-auto
        // container collapses every child to 0 height (default flex-shrink
        // has nowhere else to give), the same trap RecordList's own `<ul>`
        // avoids by staying a plain list. `space-y-2.5` gets the same gap
        // via margins instead. `p-0.5` keeps a card's own ring from being
        // clipped at the scroll box's edge.
        <ul className="max-h-[65dvh] space-y-2.5 overflow-y-auto p-0.5">
          {rows.map((row) => (
            <ProductCard
              key={row.key}
              row={row}
              entries={entries}
              fullColumns={columns}
              open={expanded.has(row.varietyId)}
              onToggle={() => onToggle(row.varietyId)}
              editable={editable}
              onCommit={onCommit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

type ColumnEntry = { column: MatrixColumn; index: number };

function ProductCard({
  row,
  entries,
  fullColumns,
  open,
  onToggle,
  editable,
  onCommit,
}: {
  row: MatrixProductRow;
  entries: ColumnEntry[];
  fullColumns: MatrixColumn[];
  open: boolean;
  onToggle: () => void;
  editable: boolean;
  onCommit: (write: MatrixWrite) => Promise<boolean>;
}) {
  // Same signal as the desktop grid's marked cells, one level up: this
  // product has demand somewhere, so it's worth opening even before you know
  // from which customer.
  const hasDemand = row.ordered > 0;

  return (
    <li
      className={`overflow-hidden rounded-xl bg-surface shadow-card ring-1 ring-inset transition-shadow duration-200 ${
        hasDemand ? "ring-marked-edge/60" : "ring-border/70"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 text-start"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{row.varietyName}</span>
          {row.familyName && (
            <span className="mt-0.5 block truncate text-xs text-ink-subtle">{row.familyName}</span>
          )}
        </span>

        <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Stat label="במלאי" value={row.inStock} />
          <Stat label="זמין" value={row.available} tone={row.available < 0 ? "danger" : "normal"} />
          {hasDemand && <StatusPill tone="brass">הוזמן {formatPallets(row.ordered)}</StatusPill>}
        </span>

        <Icon
          name="chevronDown"
          className={`h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="border-t border-border/70 bg-surface-muted/40 px-3 py-3">
          {/* Two or more growers picked this variety — the same rule
              matrix-data.ts's `expandable` encodes for the desktop grid — so
              there's no single lot to write against until one is picked. */}
          {row.expandable ? (
            <div className="flex flex-col gap-3">
              {row.growers.map((grower) => (
                <GrowerBlock
                  key={grower.pickLineId}
                  grower={grower}
                  entries={entries}
                  fullColumns={fullColumns}
                  editable={editable}
                  onCommit={onCommit}
                />
              ))}
            </div>
          ) : (
            <CustomerCellList
              owner={row}
              entries={entries}
              fullColumns={fullColumns}
              editable={editable}
              onCommit={onCommit}
            />
          )}
        </div>
      )}
    </li>
  );
}

function GrowerBlock({
  grower,
  entries,
  fullColumns,
  editable,
  onCommit,
}: {
  grower: MatrixGrowerRow;
  entries: ColumnEntry[];
  fullColumns: MatrixColumn[];
  editable: boolean;
  onCommit: (write: MatrixWrite) => Promise<boolean>;
}) {
  return (
    <div className="overflow-hidden rounded-lg bg-surface shadow-card ring-1 ring-inset ring-border/70">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-surface-muted/60 px-3 py-2">
        <p className="min-w-0 truncate text-xs font-semibold text-ink" title={grower.growerName}>
          {grower.growerName}
        </p>
        <span className="flex shrink-0 gap-3">
          <Stat label="במלאי" value={grower.inStock} />
          <Stat
            label="זמין"
            value={grower.available}
            tone={grower.available < 0 ? "danger" : "normal"}
          />
        </span>
      </div>
      <div className="px-3 py-2.5">
        <CustomerCellList
          owner={grower}
          entries={entries}
          fullColumns={fullColumns}
          editable={editable}
          onCommit={onCommit}
        />
      </div>
    </div>
  );
}

function CustomerCellList({
  owner,
  entries,
  fullColumns,
  editable,
  onCommit,
}: {
  owner: MatrixRow;
  entries: ColumnEntry[];
  fullColumns: MatrixColumn[];
  editable: boolean;
  onCommit: (write: MatrixWrite) => Promise<boolean>;
}) {
  if (entries.length === 0) {
    return <p className="px-1 py-2 text-xs text-ink-muted">אין לקוחות להצגה.</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map(({ column, index }) => {
        const cell = owner.cells[index];
        if (!cell) return null;
        // Resolved off the FULL columns array (not `entries`) — see the
        // parent component's own comment on why the index has to stay tied
        // to the unfiltered list.
        const target = cellTarget(owner, index, fullColumns);
        const wanted = cell.ordered > 0;
        const displayValue = cell.allocated > 0 ? formatPallets(cell.allocated) : "";

        return (
          <li
            key={column.customerId}
            className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md px-2.5 py-2 ${
              wanted ? "bg-marked" : "bg-surface"
            }`}
          >
            <span className="min-w-0 flex-1">
              <span
                className={`block truncate text-sm ${wanted ? "font-semibold text-marked-ink" : "text-ink"}`}
                title={column.customerName}
              >
                {column.customerName}
              </span>
              {wanted && (
                <span className="block text-[11px] text-marked-ink/80">
                  הזמין {formatPallets(cell.ordered)}
                </span>
              )}
            </span>

            {target && editable ? (
              <MatrixMobileInput
                label={`${column.customerName} — כמות`}
                displayValue={displayValue}
                target={target}
                onCommit={onCommit}
              />
            ) : (
              // Same dashed "this is a total, not a control" treatment the
              // desktop grid uses for its own read-only cells.
              <span className="flex h-11 w-24 shrink-0 items-center justify-center rounded-md border border-dashed border-border-strong bg-surface-muted/70 text-center text-sm font-semibold text-ink-muted">
                {displayValue}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MatrixMobileInput({
  label,
  displayValue,
  target,
  onCommit,
}: {
  label: string;
  displayValue: string;
  target: CellTarget;
  onCommit: (write: MatrixWrite) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(displayValue);
  // Re-seeds when the server's own value changes under us (another
  // distributor's write, or a push refetch) — tracked rather than synced in
  // an effect, so a live update lands in the same render instead of painting
  // the stale figure first. Same pattern as customer-demand-board.tsx's
  // ArrangementCell.
  const [lastSeen, setLastSeen] = useState(displayValue);
  if (lastSeen !== displayValue) {
    setLastSeen(displayValue);
    setDraft(displayValue);
  }

  async function commit() {
    const next = parseMatrixQuantity(draft);
    if (next === null) {
      setDraft(displayValue);
      return;
    }
    if (next === target.current) return;
    const landed = await onCommit({
      pickLineId: target.pickLineId,
      customerId: target.customerId,
      quantity: next,
      recordId: target.recordId,
      price: target.price,
      priceType: target.priceType,
    });
    // A refused write has to put the number back itself — see
    // arrangement-matrix.tsx's identical comment on its own commitDraft.
    if (!landed) setDraft(displayValue);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      // Digits read left-to-right inside an RTL page, the same rule every
      // number input in this app follows (see globals.css).
      dir="ltr"
      autoComplete="off"
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          // Blurring is what actually commits (onBlur above) — Enter's only
          // job is to drop the on-screen keyboard's focus so the commit runs
          // without waiting for a second, separate tap elsewhere.
          event.currentTarget.blur();
        }
      }}
      className="h-11 w-24 shrink-0 rounded-md border border-border-strong bg-surface px-2 text-center text-sm font-semibold text-ink outline-none transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/30"
    />
  );
}

function Stat({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: number;
  tone?: "danger" | "normal";
}) {
  return (
    <span className="whitespace-nowrap text-[11px]">
      <span className="text-ink-subtle">{label} </span>
      <span
        className={`font-semibold tabular-nums ${tone === "danger" ? "text-danger" : "text-ink-muted"}`}
        dir="ltr"
      >
        {formatPallets(value)}
      </span>
    </span>
  );
}
