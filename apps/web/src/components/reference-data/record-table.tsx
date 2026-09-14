import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

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

// One collapsible section of a grouped table — a product FAMILY on the
// Products screen, the only screen that groups so far. The caller owns the
// whole header row (its own expand toggle, its own edit controls, its own
// fields when the group itself is being edited), because a group is a real
// record on that screen and not merely a label: this component's job is
// only to decide which groups are listed, which are open, and which rows
// belong under which one.
export interface RecordTableGroup {
  id: string;
  // What a search term matches the GROUP against, independent of its rows —
  // so a family with no varieties yet is still findable by name.
  searchText: string;
  // The header row's content, spanning the full table width. Receives the
  // expansion state the table ACTUALLY rendered with, which is not always
  // the `expandedIds` the caller passed in (see `grouping` below) — drawing
  // the chevron from this argument is what keeps it pointing the same way
  // as the rows underneath it.
  header: (expanded: boolean) => ReactNode;
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
  grouping,
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
  // On a grouped table this may also be a GROUP's id while the group itself
  // is being edited: no row matches it, so nothing renders as an editing
  // row, but the table locks in exactly the same way (every row's
  // edit/delete disabled, the add button disabled) — which is the point,
  // since two concurrent edits on one screen would need two forms and two
  // save buttons competing for the same Escape key.
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
  // Opt-in: omit it and the table is the flat list every other screen uses.
  // All three parts are required together — a group list, the row → group
  // mapping, and which groups the USER has opened (owned by the caller, the
  // same way `editingId` is, so the screen can open a group in response to
  // its own actions, e.g. keeping the family it just added a variety to
  // open after the save).
  grouping?: {
    groups: RecordTableGroup[];
    getGroupId: (row: T) => string;
    expandedIds: ReadonlySet<string>;
  };
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

  const needle = query.trim().toLocaleLowerCase("he");

  // Whether one row survives the search box. The row being edited always
  // does, so it never disappears out from under the user just because their
  // draft no longer matches — most visibly the blank "new record" draft,
  // whose every field is empty.
  const rowMatches = useCallback(
    (row: T) =>
      needle === "" ||
      getRowId(row) === editingId ||
      searchText(row).toLocaleLowerCase("he").includes(needle),
    [needle, searchText, editingId, getRowId],
  );

  const filtered = useMemo(
    () => (needle === "" ? rows : rows.filter(rowMatches)),
    [rows, needle, rowMatches],
  );

  // Every row bucketed into the caller's groups, in the caller's order.
  // Null when the table isn't grouped, which is the signal further down to
  // render one flat list exactly as before.
  const grouped = useMemo(() => {
    if (!grouping) return null;
    const byGroup = new Map<string, T[]>();
    for (const row of rows) {
      const groupId = grouping.getGroupId(row);
      const list = byGroup.get(groupId);
      if (list) list.push(row);
      else byGroup.set(groupId, [row]);
    }

    const sections = grouping.groups.flatMap((group) => {
      const allRows = byGroup.get(group.id) ?? [];
      // Consumed, so whatever is left in the map afterwards is genuinely
      // orphaned rather than merely already-placed.
      byGroup.delete(group.id);

      // The group being edited is pinned in place for the same reason the
      // row being edited is: it must not vanish because the search box no
      // longer matches the name being typed INTO it. Most visibly a
      // brand-new group, whose name starts empty and so matches nothing.
      const pinned = group.id === editingId;

      // Searching a tree, not a list: a group that matches ON ITS OWN TEXT
      // keeps ALL of its rows, because the user asked for the group and a
      // family that opens onto nothing is worse than no result at all.
      // Otherwise only the rows that matched survive, and the group is
      // listed only if that left any — except with an empty search box,
      // where every group is listed including the empty ones, since a group
      // with no rows is still a record and its header is the only way to
      // reach it.
      const groupMatches =
        needle !== "" && group.searchText.toLocaleLowerCase("he").includes(needle);
      const groupRows =
        needle === "" || groupMatches || pinned ? allRows : allRows.filter(rowMatches);
      if (needle !== "" && !groupMatches && !pinned && groupRows.length === 0) return [];

      // Two things open a group no matter what the user last clicked:
      //   - a search whose hits are rows INSIDE it, which would otherwise
      //     sit behind a chevron the user has to guess at. A search that
      //     matched the group's own name doesn't count: there the answer is
      //     "here are the families", and force-opening each one would bury
      //     that answer under every variety they hold.
      //   - an edit in progress on one of its rows, most importantly a
      //     not-yet-saved draft row, which a collapse would destroy.
      const expanded =
        grouping.expandedIds.has(group.id) ||
        (needle !== "" && !groupMatches && groupRows.length > 0) ||
        groupRows.some((row) => getRowId(row) === editingId);

      return [{ group, rows: groupRows, expanded }];
    });

    // A row whose group id matches no listed group is still shown, after
    // every group and without a header, rather than dropped: silently
    // hiding a record because its parent is missing is the one failure mode
    // a user cannot diagnose from the screen.
    const orphans = [...byGroup.values()].flat().filter(rowMatches);
    return { sections, orphans };
  }, [grouping, rows, needle, rowMatches, editingId, getRowId]);

  const isEmpty = grouped
    ? grouped.sections.length === 0 && grouped.orphans.length === 0
    : filtered.length === 0;

  function toggleColumn(key: string) {
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // One record's <tr>. A function rather than inline JSX because a grouped
  // table emits these from inside each section as well as, for orphans,
  // outside them — and a second copy of the pinned actions cell is exactly
  // the kind of duplication that drifts.
  function renderRow(row: T) {
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
      ) : isEmpty ? (
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
            {grouped
              ? [
                  ...grouped.sections.map((section) => (
                    <Fragment key={`group:${section.group.id}`}>
                      <tr className="bg-surface-muted/70 shadow-[inset_0_1px_0_var(--color-border)]">
                        {/* One cell across the whole table, actions
                            included, rather than a header that reuses the
                            pinned actions column: that lets the caller's
                            entire header — toggle, name, its own edit
                            controls — ride in a single `sticky start-0`
                            block, so a family stays labelled while the
                            sixteen variety columns scroll horizontally
                            underneath it. `p-0` because the header owns its
                            own padding inside that block; the cell itself is
                            table-wide and padding on it would push the
                            content away from the frozen edge. */}
                        <td colSpan={visibleColumns.length + 1} className="p-0">
                          {section.group.header(section.expanded)}
                        </td>
                      </tr>
                      {/* Collapsed groups render no rows at all. The
                          height-animated `.accordion-panel` used elsewhere
                          in the app can't apply here — a <tbody> can't be a
                          CSS grid without destroying the column alignment
                          that is the entire point of a table — so the
                          motion budget goes on the chevron instead. */}
                      {section.expanded && section.rows.map(renderRow)}
                    </Fragment>
                  )),
                  ...grouped.orphans.map(renderRow),
                ]
              : filtered.map(renderRow)}
          </TableBody>
        </TableContainer>
      )}
    </div>
  );
}

// The round action button every record row carries. Exported so a grouped
// table's group header (products.tsx's family row) can use the identical
// control for the group's own edit/save/cancel rather than a second,
// nearly-matching button that drifts out of step with this one.
export function RowIconButton({
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
          ? "bg-danger-soft text-danger ring-danger/25 hover:bg-danger hover:text-danger-ink"
          : tone === "accent"
            ? "bg-accent-soft text-accent ring-accent/25 hover:bg-accent hover:text-accent-ink"
            : "bg-surface-muted text-ink-muted ring-border hover:bg-accent-soft hover:text-accent"
      }`}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}
