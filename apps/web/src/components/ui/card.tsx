import type { ReactNode } from "react";

// The app's one panel. Fourteen screens were each spelling out
// `rounded-lg border border-border bg-surface shadow-card` by hand, which is
// why card treatment drifted between them — some had a header rule, some
// didn't, padding ranged from p-3 to p-5. One component so a card is a card.
//
// `title` renders a tinted header strip; without it the card is just a
// surface and `padded` controls whether the body gets its own inset (turn it
// off when the body is a full-bleed list or table that should reach the
// card's edges).
export function Card({
  title,
  actions,
  children,
  padded = true,
  className = "",
}: {
  title?: string;
  // Trailing slot in the header — a filter toggle, a date pill, a count.
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section
      // `ring-inset` rather than `border`, so the outline never adds to the
      // card's box size and a row of cards stays exactly aligned.
      // `overflow-hidden` lets a full-bleed body meet the rounded corners.
      className={`animate-rise-in overflow-hidden rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70 ${className}`}
    >
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted/60 px-5 py-3.5">
          <h2 className="font-display text-lg text-ink">{title}</h2>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

// A labelled group of form fields. The management screens' detail panes were
// flat stacks of eight to twelve inputs with no grouping at all — every field
// weighted identically, so finding "the price one" meant reading all of them.
// This splits a form into named runs with a hairline rule, which is the
// cheapest way to make a long form navigable.
export function FormSection({
  title,
  hint,
  children,
  columns = 1,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  // Two-column packing for short, related fields (a price range, a from/to
  // pair). Collapses to one column on narrow viewports.
  columns?: 1 | 2;
}) {
  return (
    <section className="border-b border-border pb-6 last:border-b-0 last:pb-0">
      <div className="mb-4">
        <h3 className="text-[11px] font-semibold tracking-[0.08em] text-ink-subtle">{title}</h3>
        {hint && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{hint}</p>}
      </div>
      <div className={columns === 2 ? "grid gap-4 sm:grid-cols-2" : "flex flex-col gap-4"}>
        {children}
      </div>
    </section>
  );
}

// A small semantic status chip. Replaces the several one-off
// `rounded-full px-2 py-0.5 text-xs` spans scattered across the operational
// screens, each of which picked its own colors.
const TONE_CLASSES = {
  neutral: "bg-surface-muted text-ink-muted ring-border",
  accent: "bg-accent-soft text-accent ring-accent/25",
  warning: "bg-warning-soft text-warning ring-warning/25",
  danger: "bg-danger-soft text-danger ring-danger/25",
  brass: "bg-brass-soft text-brass ring-brass/30",
} as const;

export type StatusTone = keyof typeof TONE_CLASSES;

export function StatusPill({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: StatusTone;
  // A leading dot for live/state chips, so status isn't carried by color
  // alone at a glance — the dot gives the eye a shape to land on first.
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
