import type { ReactNode } from "react";

import { Icon } from "@/components/ui/icon";

// One row of the "בשם מגדל" / "בשם לקוח" oversight screens — a grower or a
// customer, today's engagement status carried by the NAME's own color
// (matching the reference design, which marks status this way rather than
// with a separate badge), three actions (edit, remind, expand), and an
// expand panel for the read-only family-grouped view of their picking/order
// data. Shared between both screens because the shell is identical; only
// what fills `children` when expanded, and what the edit pencil opens,
// differs.
const TONE_TEXT = {
  // Nothing submitted yet today — the row a distributor is most likely
  // chasing, so it gets the warmest color rather than the quietest one.
  warning: "text-warning",
  // Done: submitted or closed.
  accent: "text-accent",
  // In progress, or nothing to report either way.
  neutral: "text-ink",
} as const;

export function ExpandableEntityRow({
  name,
  tone,
  caption,
  expanded,
  onToggle,
  onEdit,
  editLabel,
  onRemind,
  remindLabel,
  remindDisabled,
  reminding,
  reminded,
  children,
}: {
  name: string;
  tone: keyof typeof TONE_TEXT;
  /** Short status line under the name once expanded — submitted time, etc. */
  caption?: string | null;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  editLabel: string;
  onRemind: () => void;
  remindLabel: string;
  remindDisabled: boolean;
  reminding: boolean;
  /**
   * Shown as a checkmark the instant the bell is clicked, optimistically —
   * before the RPC round trip confirms it — and cleared again either by the
   * caller (on a failed send) or after a few seconds (on a real one). See
   * distributor-grower.tsx / distributor-customer.tsx for the timing.
   */
  reminded?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="border-b border-border last:border-b-0">
      <div
        className={`flex items-center gap-2 py-2 ps-1 pe-3 transition-colors duration-150 ${
          expanded ? "bg-accent-soft/30" : "hover:bg-surface-muted"
        }`}
      >
        {/* Edit — opens the same full editor the grower/customer's own
            screen uses, in a dialog. A pencil rather than a link: leaving
            this list to reach a separate page would lose the distributor's
            place in a list they may be working down top to bottom. */}
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel}
          title={editLabel}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-subtle ring-1 ring-inset ring-border transition-colors duration-150 hover:bg-surface hover:text-accent hover:ring-accent/40"
        >
          <Icon name="pencil" className="h-3.5 w-3.5" />
        </button>

        {/* Remind — send_pick_reminder / send_order_reminder, the same
            write both screens already made before this redesign. A warm
            fill distinguishes it from the neutral edit button: this is the
            "nudge someone else" action, not "change what's on screen." */}
        <button
          type="button"
          onClick={onRemind}
          disabled={remindDisabled}
          aria-label={remindLabel}
          title={remindLabel}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brass-soft text-brass ring-1 ring-inset ring-brass/25 transition-colors duration-150 enabled:hover:bg-brass enabled:hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {reminding ? (
            <span
              aria-hidden
              className="animate-spin-loop h-3 w-3 rounded-full border-2 border-current border-t-transparent"
            />
          ) : reminded ? (
            <Icon name="checkCircle" className="h-3.5 w-3.5" />
          ) : (
            <Icon name="bell" className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Expand — the family-grouped read-only summary in `children`. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="group flex min-w-0 flex-1 items-center justify-between gap-2 py-1 text-start"
        >
          <span className="min-w-0">
            <span className={`block truncate text-sm font-semibold ${TONE_TEXT[tone]}`}>
              {name}
            </span>
            {caption && (
              <span className="block truncate text-[11px] text-ink-subtle">{caption}</span>
            )}
          </span>
          <Icon
            name="chevronDown"
            className={`h-4 w-4 shrink-0 transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
              expanded ? "rotate-180 text-accent" : "text-ink-muted group-hover:text-accent"
            }`}
          />
        </button>
      </div>

      {/* Height-animated, same accordion mechanism as the arrangement
          board's grower rows (globals.css `.accordion-panel`) — and
          `inert` while closed for the same reason: a collapsed row's
          content must not sit in the tab order. */}
      <div className="accordion-panel" data-open={expanded}>
        <div>
          <div className="border-t border-border bg-surface-muted/50 px-3 py-2.5" inert={!expanded}>
            {children}
          </div>
        </div>
      </div>
    </li>
  );
}
