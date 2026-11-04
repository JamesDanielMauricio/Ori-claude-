import type { Matrix } from "../matrix-data";

import {
  CELL_BORDER,
  HEADER_H,
  W_ALLOCATED,
  W_PRODUCT,
  W_STOCK,
  Z_CORNER,
  Z_HEADER,
} from "./geometry";

// The matrix's header row: the three pinned leading titles, one per
// customer, and the two pinned trailing ones.
//
// Sticky is declared per <th> rather than on the <thead>: a sticky
// thead is honoured inconsistently across browsers, while a sticky
// cell is not — and the corners need a second axis anyway.
export function MatrixHeader({ columns }: { columns: Matrix["columns"] }) {
  return (
    <thead>
      <tr style={{ height: HEADER_H }}>
        <th
          scope="col"
          style={{ right: 0 }}
          className={`sticky top-0 ${Z_CORNER} ${CELL_BORDER} bg-surface-muted px-3 text-start align-bottom pb-3 text-xs font-semibold tracking-[0.06em] text-ink-subtle`}
        >
          מוצרים
        </th>
        <th
          scope="col"
          style={{ right: W_PRODUCT }}
          className={`sticky top-0 ${Z_CORNER} ${CELL_BORDER} bg-surface-muted px-2 align-bottom pb-3 text-xs font-semibold leading-tight text-ink-subtle`}
        >
          סה״כ במלאי
        </th>
        <th
          scope="col"
          style={{ right: W_PRODUCT + W_STOCK }}
          className={`sticky top-0 ${Z_CORNER} ${CELL_BORDER} bg-surface-muted px-2 align-bottom pb-3 text-xs font-semibold leading-tight text-ink-subtle`}
        >
          סה״כ הוזמן
        </th>

        {columns.map((column) => (
          <th
            key={column.customerId}
            scope="col"
            className={`sticky top-0 ${Z_HEADER} ${CELL_BORDER} bg-surface-muted px-1.5 align-bottom pb-3 text-xs font-semibold leading-[1.25] text-ink-muted`}
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
          className={`sticky top-0 ${Z_CORNER} ${CELL_BORDER} bg-surface-muted px-2 align-bottom pb-3 text-xs font-semibold leading-tight text-ink-subtle`}
        >
          זמין
        </th>
        <th
          scope="col"
          style={{ left: 0 }}
          className={`sticky top-0 ${Z_CORNER} ${CELL_BORDER} bg-surface-muted px-2 align-bottom pb-3 text-xs font-semibold leading-tight text-ink-subtle`}
        >
          סה״כ חולק
        </th>
      </tr>
    </thead>
  );
}
