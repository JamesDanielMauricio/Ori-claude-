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
    // No rule under the header any more, and no accent bar beside the title.
    // Both were doing the job that space and type contrast should do: with a
    // 30px serif title over a 14px sans subtitle, the hierarchy is already
    // unmistakable, and a divider on top of that just adds a line to look at.
    // The generous bottom margin is the separator.
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="animate-title-settle font-display text-[1.75rem] text-ink sm:text-[2.125rem]">
          {title}
        </h1>
        {subtitle && (
          // Capped at ~68 characters per line. Long measures are the other
          // thing that makes an interface read as unconsidered — a subtitle
          // running the full width of a 1440px screen has no shape.
          <p className="animate-rise-in mt-2.5 max-w-[52ch] text-sm leading-relaxed text-ink-muted">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
