import { useEffect, useMemo, useState, type ReactNode } from "react";

import { checkboxClassName, inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface RecordTableColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  // The inline editable control for this column — an <input>/<select> bound
  // to the caller's own form state via closure, shown instead of `render`
  // while this row is the one being edited. Columns that aren't editable
  // from this screen (a joined display value, a family-level field, an
  // identity managed by Auth, a server-set timestamp) omit it and stay
  // read-only on an editing row.
  renderEdit?: (row: T) => ReactNode;
}

// The pinned first column. Frozen with `position: sticky` rather than left
// in the scroll flow: these tables are deliberately wide enough to need
// horizontal scrolling (Products carries sixteen fields), and an actions
// column that scrolls away means scrolling back to the start of the row to
// press "edit" — or worse, saving the wrong row. The `after:` hairline is
// drawn as a pseudo-element instead of a border so it can't be swallowed by
// the table's collapsed borders, and the hover fill is the exact colour the
// row's own translucent hover produces over `surface`, so the pinned cell
// tracks the row instead of sitting on it as a white notch.
//
// `z-0`, deliberately NOT the `z-10` the sticky <thead> carries: both are
// positioned, so at equal z-index the later one in document order — a body
// cell — wins, and an opaque actions cell then painted straight over the
// header as its row scrolled under it. (Very visible while editing: the
// row's save/cancel buttons appeared to float above the header instead of
// sliding out of view with their row.) Sitting one layer below the header
// keeps the cell above its own row's static cells, which is all the
// horizontal freeze actually needs.
const PINNED_CELL =
  "sticky start-0 z-0 bg-surface group-hover/row:bg-[color-mix(in_oklab,var(--color-accent-soft)_55%,var(--color-surface))] after:absolute after:inset-y-0 after:end-0 after:w-px after:bg-border";

// The five Backoffice management screens' record view (Products, Growers,
// Customers, Transporters, Users): every field of every record as its own
// column, visible at once, replacing the old list + detail-pane split
// (`ListDetailLayout`/`RecordList` — still used by order-history.tsx, so
// those stay; this is a second, denser pattern for screens where seeing
// every row's fields at once is the point).
//
// Two rules follow from that, and they're why this component looks the way
// it does:
//
//   1. Nothing is hidden behind an interaction. No expanding rows, no
//      fields that only appear once a row is in edit mode, no columns
//      hidden by default. A value that exists on the record has a column,
//      and that column shows it whether or not the row is being edited.
//      Width is solved by scrolling horizontally under a pinned actions
//      column, not by hiding fields.
//   2. Editing happens INLINE, one row at a time — the row's own cells
//      become inputs in place. `editingId` is owned by the caller (which
//      id, from `getRowId`, is mid-edit; the caller also decides what a
//      "new record" draft row's id is, e.g. "__new__", and prepends that
//      draft object to `rows` itself while it's active — this component has
//      no concept of create vs. update, only "is this particular row the
//      one being edited right now").
//
// Filtering is client-side, same rationale RecordList's own comment gives:
// reference data in the low hundreds of rows, already fetched in full.
export function RecordTable<T>({
  columns,
  rows,
  getRowId,
  searchText,
  editingId,
  savingEdit = false,
  dirtyEdit = true,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onAdd,
  addLabel,
  toolbarExtra,
  loading = false,
  searchPlaceholder = "חיפוש",
  emptyLabel = "אין רשומות עדיין.",
}: {
  columns: RecordTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  // What a search term matches against — the concatenation of whatever
  // fields are worth finding a row by, not necessarily every visible column.
  searchText: (row: T) => string;
  // The id (via getRowId) of the row currently in inline-edit mode, or null.
  editingId: string | null;
  savingEdit?: boolean;
  // Whether the editing row's draft actually differs from the server's
  // values — gates the save (checkmark) button, same rationale ActionBar's
  // own `dirty` prop gives.
  dirtyEdit?: boolean;
  // Starts inline-editing this row (the caller seeds its own form state and
  // sets `editingId`).
  onEdit: (row: T) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (row: T) => void;
  // Omitted on the one screen with no "create" flow of its own (Users —
  // accounts come from the bulk-import page instead); `toolbarExtra` is
  // where that screen puts its own links in the add button's place.
  onAdd?: (() => void) | undefined;
  addLabel?: string | undefined;
  toolbarExtra?: ReactNode;
  loading?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  // Everything starts visible (see rule 1 above). This exists so a user can
  // narrow a wide table to the columns THEY care about — an opt-out they
  // control, not a default that decides for them which fields matter.
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(() => new Set());

  const visibleColumns = columns.filter((column) => !hiddenColumns.has(column.key));

  // Escape cancels the row currently being edited — the same "back out
  // without saving" affordance the old dialog got for free from the native
  // <dialog>'s own Escape handling. A cell popover that's open swallows the
  // keypress first (see cell-popover.tsx), so Escape closes that instead of
  // discarding the whole row.
  useEffect(() => {
    if (!editingId) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancelEdit();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingId, onCancelEdit]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("he");
    if (!needle) return rows;
    // The row being edited never disappears out from under the user just
    // because their draft edit no longer matches the search box — most
    // visibly the blank "new record" draft, whose every field is empty.
    return rows.filter(
      (row) =>
        getRowId(row) === editingId || searchText(row).toLocaleLowerCase("he").includes(needle),
    );
  }, [rows, query, searchText, editingId, getRowId]);

  function toggleColumn(key: string) {
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="search"
            className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-ink-subtle"
          />
          {/* The shared field skin, minus its own inline-start padding —
              the search icon sits there instead. */}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className={`${inputClassName} w-full min-w-[10rem] ps-9`}
          />
        </div>

        {/* Column visibility — a plain <details> disclosure rather than a
            positioned popover: unlike the table's own cell popovers, this
            button doesn't sit inside a clipping scroll container, so
            there's nothing a fixed-position portal would be solving. */}
        <details className="group relative shrink-0">
          <summary
            className="flex h-10 list-none items-center gap-2 rounded-md bg-surface px-3.5 text-sm font-semibold text-ink shadow-card ring-1 ring-inset ring-border-strong transition-colors duration-150 marker:content-none hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
            aria-label="בחירת עמודות"
          >
            <Icon name="columns" className="h-4 w-4" />
            עמודות
          </summary>
          <div className="absolute end-0 top-[calc(100%+0.5rem)] z-20 max-h-80 w-56 overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-overlay">
            {columns.map((column) => (
              <label
                key={column.key}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  checked={!hiddenColumns.has(column.key)}
                  onChange={() => toggleColumn(column.key)}
                  className={checkboxClassName}
                />
                {column.label}
              </label>
            ))}
          </div>
        </details>

        {onAdd && (
          <Button type="button" onClick={onAdd} disabled={editingId !== null}>
            <Icon name="plusCircle" className="h-4 w-4" />
            {addLabel}
          </Button>
        )}
        {toolbarExtra}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-surface px-6 py-14 text-center shadow-raised ring-1 ring-inset ring-border/70">
          <Icon name={query ? "search" : "clipboard"} className="h-6 w-6 text-ink-subtle" />
          <p className="text-sm text-ink-muted">
            {query ? `אין תוצאות עבור "${query.trim()}"` : emptyLabel}
          </p>
        </div>
      ) : (
        <TableContainer className="max-h-[70dvh]">
          <TableHeader>
            <TableRow>
              {/* z-20, above the other header cells: this one is sticky on
                  BOTH axes (its thead pins it vertically, `start-0` pins it
                  horizontally) and has to stay on top of whichever header
                  cell scrolls under it. */}
              <TableHead className="sticky start-0 z-20 w-24 bg-surface-muted after:absolute after:inset-y-0 after:end-0 after:w-px after:bg-border">
                פעולות
              </TableHead>
              {visibleColumns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => {
              const id = getRowId(row);
              const isEditing = id === editingId;
              return (
                <TableRow key={id}>
                  <TableCell className={PINNED_CELL}>
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <RowIconButton
                          icon="checkCircle"
                          label="שמור"
                          tone="accent"
                          onClick={onSaveEdit}
                          disabled={savingEdit || !dirtyEdit}
                        />
                        <RowIconButton
                          icon="close"
                          label="ביטול"
                          tone="neutral"
                          onClick={onCancelEdit}
                          disabled={savingEdit}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <RowIconButton
                          icon="trash"
                          label="מחק"
                          tone="danger"
                          onClick={() => onDelete(row)}
                          disabled={editingId !== null}
                        />
                        <RowIconButton
                          icon="pencil"
                          label="ערוך"
                          tone="neutral"
                          onClick={() => onEdit(row)}
                          disabled={editingId !== null}
                        />
                      </div>
                    )}
                  </TableCell>
                  {visibleColumns.map((column) => (
                    <TableCell key={column.key}>
                      {isEditing && column.renderEdit ? column.renderEdit(row) : column.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </TableContainer>
      )}
    </div>
  );
}

function RowIconButton({
  icon,
  label,
  tone,
  onClick,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  tone: "danger" | "neutral" | "accent";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${
        tone === "danger"
          ? "bg-danger-soft text-danger ring-danger/25 hover:bg-danger hover:text-white"
          : tone === "accent"
            ? "bg-accent-soft text-accent ring-accent/25 hover:bg-accent hover:text-white"
            : "bg-surface-muted text-ink-muted ring-border hover:bg-accent-soft hover:text-accent"
      }`}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}
