import { useMemo, useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasChanges } from "@/lib/has-changes";

import { type FlatRecord } from "./board-data";
import { type AllocationPatch } from "./customer-demand-board";

type ViewMode = "by-product" | "by-grower";

// One row's three inputs as update_arrangement_record would receive them.
// Called twice per row — once on what is typed, once on what the row would
// hold freshly seeded from the server — so "is there anything to save?" is
// decided by the values that would actually be written rather than by the
// text in the boxes. Retyping "12" over a stored 12, or "3.50" over a stored
// 3.5, is then correctly not a change.
function toPatch(
  recordId: string,
  quantity: string,
  price: string,
  priceType: string,
): AllocationPatch {
  return {
    id: recordId,
    quantityPallets: Number(quantity),
    price: price === "" ? null : Number(price),
    priceType: priceType || null,
  };
}

// The flat records table, kept from the previous version of this screen and
// moved below the board as a collapsed disclosure.
//
// The board above is now the working surface: quantities are edited on the
// order line they belong to, which is where the distributor is looking. But
// the board is organised per customer, and two things this table does are not
// reachable that way — reading every record on the day in one sorted list
// (the PRD's own "arrangement records" view, and what gets checked before
// Close Arrangement), and editing a record's price/price type directly.
// Collapsed by default so it costs nothing when it isn't wanted.
export function ArrangementRecordsSection({
  records,
  editable,
  saving,
  onSave,
  onDelete,
}: {
  records: FlatRecord[];
  editable: boolean;
  saving: boolean;
  onSave: (patch: AllocationPatch) => Promise<boolean>;
  onDelete: (recordId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("by-product");

  // Same records, same fields, one different primary sort key — R6's "one
  // function, two groupings", not two data models.
  const sorted = useMemo(() => {
    return [...records].sort((a, b) => {
      const primary =
        viewMode === "by-grower"
          ? a.growerName.localeCompare(b.growerName, "he")
          : a.varietyLabel.localeCompare(b.varietyLabel, "he");
      if (primary !== 0) return primary;
      return viewMode === "by-grower"
        ? a.varietyLabel.localeCompare(b.varietyLabel, "he")
        : a.growerName.localeCompare(b.growerName, "he");
    });
  }, [records, viewMode]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="group flex items-center gap-2.5 text-start"
        >
          <Icon
            name="chevronDown"
            className={`h-4 w-4 shrink-0 transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
              open ? "rotate-180 text-accent" : "text-ink-muted group-hover:text-accent"
            }`}
          />
          <h2 className="text-sm font-semibold text-ink">רשומות סידור</h2>
          <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums text-ink-muted ring-1 ring-inset ring-border">
            {records.length}
          </span>
        </button>

        {open && (
          // A real segmented control: one track, one moving selection.
          <div
            role="group"
            aria-label="תצוגת רשומות"
            className="animate-pop-in inline-flex gap-1 rounded-lg bg-surface-muted p-1 ring-1 ring-inset ring-border"
          >
            {(
              [
                ["by-product", "לפי מוצר"],
                ["by-grower", "לפי מגדל"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                  viewMode === mode
                    ? "bg-surface text-ink shadow-card"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Genuinely unmounted when closed, unlike the accordions on the board.
          This table can run to hundreds of rows, each with three controlled
          inputs; keeping it mounted to animate a collapse would cost more
          than the animation is worth on the one section nobody has open by
          default. */}
      {open && (
        <TableContainer>
          <TableHeader>
            <TableRow>
              <TableHead>זן</TableHead>
              <TableHead>מגדל</TableHead>
              <TableHead>לקוח</TableHead>
              <TableHead>כמות</TableHead>
              <TableHead>מחיר</TableHead>
              <TableHead>סוג תמחור</TableHead>
              <TableHead>פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <ArrangementRecordRow
                key={row.recordId}
                row={row}
                editable={editable}
                saving={saving}
                onSave={onSave}
                onDelete={() => onDelete(row.recordId)}
              />
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell className="text-ink-muted" colSpan={7}>
                  אין רשומות סידור עדיין.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </TableContainer>
      )}
    </section>
  );
}

function ArrangementRecordRow({
  row,
  editable,
  saving,
  onSave,
  onDelete,
}: {
  row: FlatRecord;
  editable: boolean;
  saving: boolean;
  onSave: (patch: AllocationPatch) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [quantity, setQuantity] = useState(String(row.quantity));
  const [price, setPrice] = useState(row.price === null ? "" : String(row.price));
  const [priceType, setPriceType] = useState(row.priceType ?? "");

  // Re-seed the inputs when the server's copy of this record changes under us.
  //
  // A `useState` initializer only runs on the first mount, and these rows are
  // keyed by record id, so a row that stays on screen kept rendering whatever
  // it was seeded with no matter what the board refetched. That is not
  // theoretical: close_arrangement FILLS IN price/price_type on every
  // un-priced record (apply_arrangement_pricing, migration 0022 — the
  // variety's fixed price, else its range midpoint). Closing the arrangement
  // therefore wrote real prices to the database while this table went on
  // showing the empty boxes from before the close, now disabled, with no way
  // to see the finalized figures short of a full page reload.
  //
  // Editing a quantity on the board above lands here the same way, which is
  // the second reason this stayed: the two views of a record must not drift.
  //
  // Tracking the last-seen server values rather than syncing in an effect
  // keeps this a single render: an effect would paint the stale values first
  // and correct them on the next frame.
  const [lastServer, setLastServer] = useState(row);
  if (
    lastServer.quantity !== row.quantity ||
    lastServer.price !== row.price ||
    lastServer.priceType !== row.priceType
  ) {
    setLastServer(row);
    setQuantity(String(row.quantity));
    setPrice(row.price === null ? "" : String(row.price));
    setPriceType(row.priceType ?? "");
  }

  // What "שמור" would write, and what the row already holds. Built from the
  // same expressions that seed the three inputs above, so the two sides can
  // only differ where the user actually changed something.
  const patch = toPatch(row.recordId, quantity, price, priceType);
  const dirty = hasChanges(
    patch,
    toPatch(
      row.recordId,
      String(row.quantity),
      row.price === null ? "" : String(row.price),
      row.priceType ?? "",
    ),
  );

  return (
    <TableRow>
      <TableCell>{row.varietyLabel}</TableCell>
      <TableCell>{row.growerName}</TableCell>
      <TableCell>{row.customerName}</TableCell>
      <TableCell>
        <input
          type="number"
          step="1"
          min={0}
          disabled={!editable}
          aria-label="כמות משטחים"
          className={`${inputClassName} w-24`}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <input
          type="number"
          step="0.01"
          min={0}
          disabled={!editable}
          aria-label="מחיר"
          className={`${inputClassName} w-24`}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <input
          disabled={!editable}
          aria-label="סוג תמחור"
          className={`${inputClassName} w-24`}
          value={priceType}
          onChange={(event) => setPriceType(event.target.value)}
        />
      </TableCell>
      <TableCell>
        {editable && (
          <div className="flex gap-1">
            <Button
              type="button"
              variant="secondary"
              // Greyed out until one of the three fields actually differs
              // from the stored record: with nothing changed this would spend
              // a write, a board refetch and a re-render to store the values
              // already there.
              disabled={saving || !dirty}
              // This row keeps whatever was typed on a rejection — unlike the
              // board's inline editor, it has an explicit save button and the
              // three fields beside it, so the value being corrected is
              // plainly a draft. `onSave` resolves rather than rejects, so
              // there is nothing here to leave unhandled.
              onClick={() => void onSave(patch)}
            >
              שמור
            </Button>
            <Button type="button" variant="danger" disabled={saving} onClick={onDelete}>
              מחק
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
