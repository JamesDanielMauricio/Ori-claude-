// The arrangement matrix's fixed geometry — every size, sticky offset and
// layer the grid, its rows, its header and its custom scrollbars share.

// Fixed geometry. Every sticky offset below is a running sum of these, and
// the virtualiser multiplies ROW_H by an index, so they have to be constants
// rather than measured — a row whose height depended on its content would
// make both the offsets and the scroll maths wrong.
export const ROW_H = 64;
// Sized to the header's own worst case, not picked round: a customer name
// wraps at most 4 lines (`line-clamp-4` below) at 12px (`text-xs`) with
// leading-[1.25], i.e. 4 × 15px = 60px, plus the cells' pb-3 (12px) = 72px,
// plus a small buffer against font-metric rounding. It used to be 112 — measured against
// the actual rendered header, that left 86px of blank space above a
// one-line name like "Customer 01" (76% of the row), which is what made the
// header look broken and made the already-thin scrollbar thumb (necessarily
// tiny — see the scrollport's comment in arrangement-matrix.tsx) look lost inside
// an oversized empty band above it.
export const HEADER_H = 80;
// One width is NOT here: the products column's. It follows the grid's own
// width (matrix-data.ts's productColumnWidth), so it is worked out in the
// component from the measured scrollport and handed down. It is still one
// number per render, shared by the <col>, the sticky offsets and the scroll
// margins, which is all the fixed-geometry rule above actually needs.
export const W_STOCK = 88;
export const W_AVAILABLE = 80;
// As narrow as a customer's name on up to four lines allows: every pixel it
// gives up is a pixel of another customer on screen without scrolling.
export const W_CUSTOMER = 104;
export const W_ORDERED = 92;
export const W_ALLOCATED = 92;
// Under this width the products column switches to its compact label: no
// alignment spacer, a slightly smaller name on up to three lines.
export const COMPACT_PRODUCT_BELOW = 160;
/** Total width of the pinned trailing (left, in RTL) pane. */
export const TRAIL_PANE = W_AVAILABLE + W_ALLOCATED;
/** Rows rendered beyond each edge of the viewport, so a flick doesn't blank. */
export const OVERSCAN = 6;

// BOTH scrollbars here are custom-drawn, replacing the native ones outright
// — see the scrollport's own comment (arrangement-matrix.tsx) for the two things that ruled out
// styling the native ones instead. A native VERTICAL thumb, sized strictly
// proportionally to real content (~39,000px for today's ~600-row catalog
// against a ~700px viewport), is correctly only a few pixels tall — too
// small to see or grab — so browsers enforce their own minimum; we need the
// same floor explicitly since we're drawing it ourselves. 28/40px are
// comfortably clickable without, on a short list or narrow table, dominating
// the track.
export const MIN_THUMB_H = 28;
export const MIN_THUMB_W = 40;
/** Gap kept between a custom thumb and the card's own rounded corners. */
export const THUMB_INSET = 6;
// Reserved at the corner where both thumbs would otherwise land — the
// vertical thumb's home is `left: 4` + its own w-2 (8px), and the horizontal
// thumb's is `bottom: 4` + its h-2, so without this each track would let its
// thumb slide the last few pixels half-underneath the other one. Applied to
// only ONE end of each track (the end nearest the other thumb's fixed
// edge — see `measure()`), and only when the OTHER axis actually has
// something to scroll; a table that only overflows vertically still gets
// the full-height vertical track a plain scrollbar would have.
export const CORNER_GUTTER = 18;

// Layering, lowest to highest: an ordinary cell, a cell in a frozen column, a
// header cell, and the four corners that are both. Without this the frozen
// columns scroll *over* the header, or the header scrolls over nothing.
export const Z_STICKY_COL = "z-20";
export const Z_HEADER = "z-30";
export const Z_CORNER = "z-40";

export const CELL_BORDER = "border-b border-e border-border/70";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
