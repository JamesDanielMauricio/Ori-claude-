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
      className={`overflow-auto rounded-lg border border-border bg-surface shadow-card ${className}`}
    >
      <table className="w-full min-w-max border-collapse text-start text-sm">{children}</table>
    </div>
  );
}

// `surface-muted` rather than plain `surface`: while the body scrolls under
// it, a pinned header that is the same white as the rows it overlaps has no
// visible edge and the top row appears to slide under nothing. The inset
// box-shadow draws the bottom rule, because a real `border-b` on a sticky
// <thead> is not painted consistently once the header detaches.
export function TableHeader({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-surface-muted shadow-[inset_0_-1px_0_var(--color-border)]">
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
export function TableRow({ children }: { children: ReactNode }) {
  return <tr className="transition-colors hover:bg-accent-soft/60">{children}</tr>;
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
      className={`px-4 py-2.5 text-start text-xs font-semibold tracking-wide text-ink-muted ${className}`}
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
    <td className={`px-4 py-2.5 align-middle ${className}`} {...props}>
      {children}
    </td>
  );
}
