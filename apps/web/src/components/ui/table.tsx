import type { ReactNode, TdHTMLAttributes } from "react";

// A table whose header stays pinned while the body scrolls — the source
// app added this as a fix after the fact (per the PRD's screen decomposition
// notes on the Arrangement/order-history views); built in from the start
// here instead. The scroll area is self-contained (`overflow-auto` on the
// wrapper) so `sticky` positioning doesn't depend on guessing the
// surrounding page's scroll offset.
export function TableContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-auto rounded-lg border border-border ${className}`}>
      <table className="w-full min-w-max border-collapse text-start text-sm">{children}</table>
    </div>
  );
}

export function TableHeader({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-surface shadow-[inset_0_-1px_0_var(--color-border)]">{children}</thead>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr className="hover:bg-canvas">{children}</tr>;
}

export function TableHead({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-start font-medium text-ink-muted ${className}`} scope="col">
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
    <td className={`px-4 py-3 ${className}`} {...props}>
      {children}
    </td>
  );
}
