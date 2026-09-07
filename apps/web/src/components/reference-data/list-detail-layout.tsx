import type { ReactNode } from "react";

// The shape all five Backoffice management screens share (PRD: "a
// sortable list of records on one side, an editable detail panel on the
// other"). Bubble couldn't reuse this across entities — each screen got
// its own copy of the same layout — but there's no such constraint here,
// so it's one real component instead of five near-identical ones (R1).
//
// `header` (optional) renders a page-title block above the two panes and
// keeps the viewport-height math in ONE place: the outer column is pinned
// to the viewport (minus the main area's padding) and the panes flex to
// fill what the header leaves, so every screen's list scrolls internally
// at exactly the same height instead of each page re-deriving its own
// calc().
export function ListDetailLayout({
  header,
  list,
  detail,
}: {
  header?: ReactNode;
  list: ReactNode;
  detail: ReactNode;
}) {
  return (
    // The subtracted value must track the main area's vertical padding in the
    // route layouts (md:p-8 = 4rem total, lg:p-10 = 5rem). If those change,
    // change these with them or the list pane overflows the viewport.
    <div className="flex h-full min-h-0 flex-col md:h-[calc(100dvh-4rem)] lg:h-[calc(100dvh-5rem)]">
      {header && <div className="shrink-0">{header}</div>}
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <div className="flex min-h-0 w-full flex-col md:w-80 md:shrink-0">{list}</div>
        {/* The detail pane is the screen's focus — it's where every edit
            happens — so it carries the heavier of the two elevations. The
            list beside it keeps whatever its own screen gives it, and the
            difference in depth is what tells the eye which side is the
            subject and which is the index. */}
        <div className="animate-rise-in min-h-0 flex-1 overflow-y-auto rounded-xl bg-surface p-6 shadow-raised ring-1 ring-inset ring-border/70">
          {detail}
        </div>
      </div>
    </div>
  );
}
