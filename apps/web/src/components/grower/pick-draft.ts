import type { PickProductLineRow } from "@/lib/queries/grower";

// The pick editor's draft — what the inputs hold, as text — and the pure
// rules for turning it into what save_pick_lines receives. Kept apart from
// the component so the rules can be tested on their own.

export interface DraftLine {
  id: string;
  pallets: string;
  leftover: string;
  comment: string;
}

// The draft holds what the inputs hold — text — while the counts arrive as
// numbers.
export function toDraftLines(rows: PickProductLineRow[]): DraftLine[] {
  return rows.map((row) => ({
    id: row.id,
    pallets: String(row.pallets_picked),
    leftover: String(row.leftover_pallets),
    comment: row.comment ?? "",
  }));
}

// The draft as save_pick_lines would actually receive it. Used for both the
// save itself and the "is there anything to save?" comparison behind the
// ActionBar's buttons, so that question is answered by the payload rather
// than by the text in the inputs.
//
// That distinction is the whole point here. The draft is text, so a grower
// who clears a field showing "8" and types "08" — or clears a "0" and leaves
// it empty — has a draft that differs textually from the server while
// meaning exactly the same thing. Comparing the sent values (8 === 8, 0 ===
// 0) calls that unchanged, which it is. `productLabel` drops out for the
// same reason: it is display text this editor never saves.
export function toSavedLines(lines: DraftLine[]) {
  return lines.map((line) => ({
    dailyPickProductId: line.id,
    palletsPicked: Number(line.pallets || 0),
    leftoverPallets: Number(line.leftover || 0),
    comment: line.comment || null,
  }));
}

// The draft after the pick changed on the server while this editor was open
// (the live updates refetch its lines): every line this person has NOT
// edited takes the server's current value, the lines they HAVE edited keep
// what they typed, and a line that has left the pick (its variety went out
// of season) leaves the draft too. The draft used to freeze at the first
// keystroke, so a grower and the distributor's pencil, each changing a
// different line, overwrote each other's change with a stale copy.
export function mergeServerLines(
  draft: DraftLine[],
  rows: PickProductLineRow[],
  editedIds: ReadonlySet<string>,
): DraftLine[] {
  const mine = new Map(
    draft.filter((line) => editedIds.has(line.id)).map((line) => [line.id, line]),
  );
  return toDraftLines(rows).map((line) => mine.get(line.id) ?? line);
}

// What a save sends: only the lines this person changed. save_pick_lines
// updates exactly the lines it is given and leaves the rest alone, so a
// line nobody here touched is never rewritten — whatever someone else did to
// it, even in the instant before this save, stays. Nothing changed means
// nothing is sent (a save on an unchanged draft pick still sends the pick).
export function linesToSave(draft: DraftLine[], editedIds: ReadonlySet<string>) {
  return toSavedLines(draft.filter((line) => editedIds.has(line.id)));
}
