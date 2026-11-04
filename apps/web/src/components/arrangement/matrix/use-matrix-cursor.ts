import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";

import { cellTarget, parseMatrixQuantity, type Matrix, type MatrixRow } from "../matrix-data";

import { HEADER_H, ROW_H } from "./geometry";

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

/** Where a cell is, plus which row that was — see `resolve`. */
export interface CellAddress {
  row: number;
  col: number;
  key: string;
}

// The spreadsheet half of the matrix: which cell is focused, which one is
// being typed into, the arrow/Enter/Escape keys, and committing a typed
// quantity through `onCommit`. Scrolling a target row into view needs the
// scrollport (`scrollRef`), and focusing it waits for `range` to mount it.
export function useMatrixCursor({
  rows,
  columns,
  scrollRef,
  range,
  onCommit,
}: {
  rows: MatrixRow[];
  columns: Matrix["columns"];
  scrollRef: RefObject<HTMLDivElement | null>;
  range: { start: number; end: number };
  /** Resolves to whether the write landed; a refusal reverts the cell. */
  onCommit: (write: MatrixWrite) => Promise<boolean>;
}) {
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

  /** An address, or null once the row it named is no longer at that index. */
  function resolve<T extends CellAddress>(address: T | null): T | null {
    if (!address) return null;
    return rows[address.row]?.key === address.key ? address : null;
  }

  const activeCell = resolve(active);
  const draftCell = resolve(draft);

  // ---- focus -----------------------------------------------------------
  // Focus is applied here rather than at the call site because the target
  // cell may not be mounted yet: moving to a row outside the rendered window
  // scrolls first, and only once `range` has caught up does the input exist
  // to receive focus. Hence `range` in the dependencies — this effect is the
  // second half of every navigation. (`scrollRef` is listed only because it
  // arrives as an argument; it is the same ref object on every render, so it
  // never re-runs the effect.)
  useEffect(() => {
    if (!activeCell) return;
    const input = scrollRef.current?.querySelector<HTMLInputElement>(
      `input[data-cell="${activeCell.row}-${activeCell.col}"]`,
    );
    if (input && document.activeElement !== input) {
      input.focus();
      input.select();
    }
  }, [activeCell, range, scrollRef]);

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

    // Shared with the mobile card view (matrix-data.ts) so a quantity is
    // accepted or rejected by the same rule wherever it's typed. Emptying a
    // cell parses to 0, which means "nothing is arranged here" — a deletion,
    // not a no-op; the route turns a zero into delete_arrangement_record.
    const next = parseMatrixQuantity(pending.value);
    if (next === null) return;
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

    // Whole pallets only — a decimal point or comma never reaches the field.
    if (event.key === "." || event.key === ",") {
      event.preventDefault();
      return;
    }

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

  return { activeCell, draftCell, setActive, setDraft, commitDraft, handleKeyDown };
}
