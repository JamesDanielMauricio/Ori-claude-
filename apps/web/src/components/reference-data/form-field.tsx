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
// The resting fill is `surface-muted`, going white only on focus. A form of
// white boxes on a white card has to rely entirely on its borders to show
// where the fields are; a recessed fill makes them legible as inputs at a
// glance, and the shift to white on focus is then a real signal.
//
// Three things carry the "considered object" feel rather than "browser
// default in a nicer colour":
//   - a 1px inset top shadow, so the field reads as genuinely recessed into
//     the card instead of as a flat rectangle drawn on it. It's the same
//     trick Button uses in reverse (an inset top HIGHLIGHT, to read as
//     raised) — the pair is what makes buttons and fields feel like
//     different kinds of object rather than differently-coloured boxes.
//   - a focus state of two parts: the crisp 2px inset accent ring, plus a
//     soft outer halo mixed from the accent token itself. One says "this is
//     the field"; the halo says "and the app is listening". Mixed with
//     `color-mix` from `--color-accent` rather than hardcoded, so it follows
//     the token when a subtree re-points it (the dark auth card does).
//   - `caret-accent`, so even the text cursor belongs to the palette.
//
// `field-control` is a marker for globals.css, which handles the parts
// Tailwind can't reach: the chevron a <select> draws for itself, the spin
// buttons on a number field, the clock glyph in a time field.
//
// (No width utility here on purpose: callers set their own — `w-32` on the
// order screen's quantity box, full-bleed in the reference-data forms — and a
// `w-full` baked in here would collide with those unpredictably, since
// Tailwind emits both classes at equal specificity and the winner depends on
// their order in the generated sheet rather than on the order written here.)
export const inputClassName =
  "field-control h-10 rounded-lg bg-surface-muted px-3.5 text-sm text-ink caret-accent ring-1 ring-inset ring-border-strong shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] transition-[background-color,box-shadow,color] duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)] hover:bg-surface hover:ring-ink-subtle focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_18%,transparent)] disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted disabled:shadow-none disabled:ring-border";

// The checkbox, which is the one control the skin above can't help: a native
// checkbox ignores every property that matters (fill, radius, ring) and
// obeys only `accent-color`, so it stays a system widget sitting in the
// middle of a styled form. This replaces it outright — see `.field-check` in
// globals.css, which draws the box and its checkmark — while keeping a real
// <input type="checkbox"> underneath, so it remains keyboard-operable,
// announced correctly, and reachable by label the way the tests find it.
export const checkboxClassName = "field-check";
