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
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
