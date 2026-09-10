import type { ReactElement } from "react";

import { useWide } from "@/lib/use-wide";

// The "בשם מגדל" / "בשם לקוח" screens' layout: one column of rows on a
// narrow screen, two side by side from `lg` up. Purely a layout concern —
// what each row IS (edit pencil, remind bell, expand chevron, the
// family-grouped panel underneath) is `ExpandableEntityRow`; this only
// decides how many of them sit per line.
//
// Decides the breakpoint in JS (`useWide`, lib/use-wide.ts) and renders ONE
// of the two layouts, rather than mounting both and toggling visibility with
// a media query — the more common React pattern, and the first one tried
// here. That approach mounted every row TWICE (a hidden `lg:hidden` copy plus
// the visible one), which is a real cost, not just noise: it doubles this
// screen's DOM and accessibility tree for a list that can run to dozens of
// companies, and it means a plain `getByRole` query in a test — or a screen
// reader's — matches the row twice, once landing on the CSS-hidden copy,
// which just times out waiting for an element that will never become
// visible. Deciding once, in JS, and rendering only the layout that's
// actually showing avoids both.
//
// The two-column split alternates by index off the caller's own (already
// alphabetical) order, rather than taking the first/second HALF of the
// list. That keeps two properties a plain top-half/bottom-half split loses:
// scanning down EITHER column alone still reads alphabetically (not "A–M"
// vs "N–Z"), and — the more load-bearing reason — every row in a column
// stacks independently of the other column's heights. A CSS grid with both
// columns as literal grid cells would pair row N of column A with row N of
// column B on one grid row; expanding a company's family panel would then
// stretch that whole grid row, leaving a large gap beside whatever
// unrelated row happens to share it. Two independent lists have no such
// pairing, and unlike native CSS multi-column (`columns: 2`), membership is
// fixed rather than rebalanced across columns every time a row's height
// changes — the last thing an expanding accordion needs is its neighbours
// hopping to the other column mid-interaction.
const WIDE_QUERY = "(min-width: 1024px)"; // Tailwind's `lg` breakpoint.

export function TwoColumnRowList({ rows }: { rows: ReactElement[] }) {
  const wide = useWide(WIDE_QUERY);

  const listClass =
    "divide-y divide-border overflow-hidden rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70";

  if (!wide) {
    return <ul className={listClass}>{rows}</ul>;
  }

  const columnA: ReactElement[] = [];
  const columnB: ReactElement[] = [];
  rows.forEach((row, index) => (index % 2 === 0 ? columnA : columnB).push(row));

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <ul className={listClass}>{columnA}</ul>
      <ul className={listClass}>{columnB}</ul>
    </div>
  );
}
