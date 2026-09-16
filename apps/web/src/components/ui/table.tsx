import type { ReactNode, TdHTMLAttributes } from "react";

// A table whose header stays pinned while the body scrolls — the source
// app added this as a fix after the fact (per the PRD's screen decomposition
// notes on the Arrangement/order-history views); built in from the start
// here instead. The scroll area is self-contained (`overflow-auto` on the
// wrapper) so `sticky` positioning doesn't depend on guessing the
// surrounding page's scroll offset.
export function TableContainer({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`animate-rise-in overflow-auto rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70 ${className}`}
    >
      <table className="w-full min-w-max border-collapse text-start text-sm">{children}</table>
    </div>
  );
}

// A tint distinct from the rows it overlaps: while the body scrolls under it,
// a pinned header the same colour as those rows has no visible edge and the
// top row appears to slide under nothing. The header is also translucent +
// blurred, so rows passing beneath it stay faintly visible instead of
// vanishing at a hard line — that gives the scroll a sense of depth rather
// than of content being deleted at the boundary.
//
// The tint is mixed from `ink` rather than taken from the `surface-muted`
// token, because that token does not flip with the theme the way this needs
// to: it is *darker* than `surface` in both themes, which reads correctly on
// the light page (#f3f3f1 under #ffffff) but is only five points of luminance
// apart in the dark one (#171716 under #1c1c1a) — invisible, and at 85% alpha
// invisible twice over. Mixing the ink colour into the surface instead is
// self-flipping: dark ink darkens the light page, light ink lightens the dark
// one, so the header separates from the body in both.
//
// The inset box-shadow draws the bottom rule, because a real `border-b` on a
// sticky <thead> is not painted consistently once the header detaches.
export function TableHeader({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-[color-mix(in_oklab,var(--color-ink)_7%,var(--color-surface))]/90 shadow-[inset_0_-1px_0_var(--color-border-strong)] backdrop-blur-sm">
      {children}
    </thead>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

// The hover tint is the accent's soft variant, not a gray: in a wide table
// the point of row hover is to trace one record across many columns, and a
// faint green band is easier to follow to the far edge than a gray one that
// competes with the header and the zebra of the borders.
//
// The inline-start marker bar is drawn with a `box-shadow` inset rather than
// a border, so it appears on hover without the 3px width shifting every cell
// in the row sideways — the eye reads the row as highlighted, not as moved.
// Its offset is NEGATIVE (`inset_-3px`): box-shadow takes physical offsets,
// not logical ones, and a positive x draws the bar down the physical LEFT
// edge — which in this RTL app is the inline *end*, i.e. the far side of the
// row from where the eye starts and where the pinned actions column sits.
// `group/row` (a NAMED group, not a bare `group`) so a cell can react to
// its own row being hovered — the record table's pinned actions column
// needs it, since an opaque frozen cell can't show the row tint painted
// underneath it. Named deliberately: a bare `group` here would also fire
// every unnamed `group-hover:` inside any row in the app, e.g. the
// arrangement records table's chevron, which means to follow its own button.
export function TableRow({ children }: { children: ReactNode }) {
  return (
    <tr className="group/row transition-[background-color,box-shadow] duration-150 hover:bg-accent-soft/55 hover:shadow-[inset_-3px_0_0_var(--color-accent)]">
      {children}
    </tr>
  );
}

export function TableHead({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      // Uppercase-style letterspacing does nothing for Hebrew (which has no
      // case), so the header's separation from the body comes from weight,
      // size and color instead.
      // Small, letterspaced and subtle rather than bold and dark. A header row
      // that competes with the data underneath it is the most common way a
      // dense table starts to feel cheap; its job is to be findable when
      // looked for, not to be read on every pass.
      className={`px-4 py-3 text-start text-xs font-semibold tracking-[0.06em] text-ink-muted ${className}`}
      scope="col"
    >
      {children}
    </th>
  );
}

export function TableCell({
  children,
  className = "",
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { children: ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-3 align-middle ${className}`} {...props}>
      {children}
    </td>
  );
}
