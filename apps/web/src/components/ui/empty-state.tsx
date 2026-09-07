import type { ReactNode } from "react";

import { Icon, type IconName } from "./icon";

// The "nothing selected / nothing here yet" panel. Every management screen
// previously filled its entire detail pane — the largest area on the page —
// with a single muted sentence pinned to the top corner ("בחר משתמש
// מהרשימה."), which is what made those screens read as broken rather than as
// waiting. This centers a real state in that space: an icon, a heading, and
// the sentence demoted to a hint under it.
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  // Optional call to action — "create the first one", typically.
  action?: ReactNode;
}) {
  return (
    <div className="animate-rise-in flex h-full min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      {/* Concentric discs rather than a bare glyph. A single small icon
          floating in a large empty pane looks like a loading failure; giving
          it a base makes the emptiness look intentional. */}
      <span
        aria-hidden
        className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-surface-muted ring-1 ring-inset ring-border"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink-subtle ring-1 ring-inset ring-border">
          <Icon name={icon} className="h-5 w-5" />
        </span>
      </span>
      <h2 className="font-display text-xl text-ink">{title}</h2>
      {hint && <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-muted">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
