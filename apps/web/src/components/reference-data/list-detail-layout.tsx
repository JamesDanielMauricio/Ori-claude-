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
    <div className="flex h-full min-h-0 flex-col md:h-[calc(100dvh-3rem)]">
      {header && <div className="shrink-0">{header}</div>}
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <div className="flex min-h-0 w-full flex-col md:w-80 md:shrink-0">{list}</div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-card">
          {detail}
        </div>
      </div>
    </div>
  );
}
