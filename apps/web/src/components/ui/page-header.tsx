import type { ReactNode } from "react";

// Every screen's title block — one component so headings, optional
// subtitle, and the action slot sit identically on every route instead
// of each page improvising its own h1 treatment (or, as several screens
// did before the design pass, having no visible title at all).
//
// The subtitle doubles as the v1.3 spec's "(i) icon → inline explanatory
// text" rule (§12): context a screen needs to explain lives here as
// always-visible text, never behind a hover/tap icon.
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    // A hairline rule under the header gives the title block a floor, so a
    // screen whose body is one big table doesn't start with the table
    // hanging directly off the heading. `items-center` on the wrap axis
    // keeps the action buttons optically aligned to the title, not to the
    // top of a two-line subtitle.
    <header className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border pb-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
