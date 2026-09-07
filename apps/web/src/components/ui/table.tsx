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

// `surface-muted` rather than plain `surface`: while the body scrolls under
// it, a pinned header that is the same white as the rows it overlaps has no
// visible edge and the top row appears to slide under nothing. The header is
// also translucent + blurred, so rows passing beneath it stay faintly visible
// instead of vanishing at a hard line — that gives the scroll a sense of
// depth rather than of content being deleted at the boundary.
//
// The inset box-shadow draws the bottom rule, because a real `border-b` on a
// sticky <thead> is not painted consistently once the header detaches.
export function TableHeader({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-surface-muted/85 shadow-[inset_0_-1px_0_var(--color-border)] backdrop-blur-sm">
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
export function TableRow({ children }: { children: ReactNode }) {
  return (
    <tr className="transition-[background-color,box-shadow] duration-150 hover:bg-accent-soft/55 hover:shadow-[inset_3px_0_0_var(--color-accent)]">
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
      className={`px-5 py-3.5 text-start text-[11px] font-semibold tracking-[0.08em] text-ink-subtle ${className}`}
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
    <td className={`px-5 py-3.5 align-middle ${className}`} {...props}>
      {children}
    </td>
  );
}
