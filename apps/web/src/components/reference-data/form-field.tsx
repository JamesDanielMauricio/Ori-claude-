import type { ReactNode } from "react";

export function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* Full-ink label rather than muted: the label is the field's name, not
          secondary commentary, and muting it made every form read as
          disabled. Secondary weight comes from size (13px), not from color. */}
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

// The shared input skin. A fixed h-9 matches Button's md size so a field and
// the button beside it are the same height; `border-strong` gives the field a
// visible edge (the hairline `border` disappeared against white); and focus
// draws an accent ring *inside* the border rather than the browser's default
// outline, so the field visibly "activates" instead of gaining a halo that
// overlaps its neighbor in a tight two-column form.
export const inputClassName =
  "h-9 rounded-md border border-border-strong bg-surface px-3 text-sm text-ink transition-colors hover:border-ink-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-ink-muted";
