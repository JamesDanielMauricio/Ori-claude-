// How the matrix's cells look by what they say — shared by the grid's rows
// (./row.tsx) and the mobile list (../arrangement-matrix-mobile.tsx), which
// imports them through ../arrangement-matrix.tsx.

/** The empty grid's message when the caller gives none: a search matched nothing. */
export const NO_ROWS_LABEL = "אין מוצרים להצגה — נסה מונח חיפוש אחר.";

// A customer cell's colours by what it says (matrix-data.ts's cellTone):
// yellow for an order nothing is arranged against yet, orange for a cell
// holding pallets. `fill` is null where the cell takes its row's own
// background. Written out in full because Tailwind only emits classes it can
// find spelled whole in the source. Shared with the mobile list.
export const CELL_TONE = {
  none: { fill: null, ink: "text-ink-subtle", soft: "text-ink-muted" },
  ordered: { fill: "bg-marked", ink: "text-marked-ink", soft: "text-marked-ink/80" },
  arranged: { fill: "bg-arranged", ink: "text-arranged-ink", soft: "text-arranged-ink/80" },
} as const;

// A number that is a proposal's and not saved yet — suggested, or typed while
// one is open. One look for it wherever it is drawn: in the box it can be
// corrected in and in a read-only total, on both presentations of the grid.
export const UNSAVED_BOX = "border-dashed border-accent bg-accent-soft text-accent";
export const UNSAVED_TITLE = "הצעה — עדיין לא נשמרה";
