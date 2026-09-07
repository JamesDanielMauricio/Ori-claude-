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

// The shared input skin. A fixed h-10 matches Button's md size so a field and
// the button beside it are the same height (both grew from 9 in this pass —
// if one changes, the other has to); `ring-inset` gives the field a visible
// edge without adding to its box height the way a border would; and focus
// draws an accent ring rather than the browser's default outline, so the
// field visibly "activates" instead of gaining a halo that overlaps its
// neighbor in a tight two-column form.
//
// Two additions in this pass:
//   - the resting fill is `surface-muted`, going white only on focus. A form
//     of white boxes on a white card has to rely entirely on its borders to
//     show where the fields are; a recessed fill makes them legible as inputs
//     at a glance, and the shift to white on focus is then a real signal.
//   - the focus ring animates in via a transition on box-shadow, so tabbing
//     through a form is a sequence of soft handoffs rather than a hard blink
//     per field.
// (No width utility here on purpose: callers set their own — `w-32` on the
// order screen's quantity box, full-bleed in the reference-data forms — and a
// `w-full` baked in here would collide with those unpredictably, since
// Tailwind emits both classes at equal specificity and the winner depends on
// their order in the generated sheet rather than on the order written here.)
export const inputClassName =
  "h-10 rounded-md bg-surface-muted px-3.5 text-sm text-ink ring-1 ring-inset ring-border-strong transition-[background-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)] hover:bg-surface hover:ring-ink-subtle focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted disabled:ring-border";
