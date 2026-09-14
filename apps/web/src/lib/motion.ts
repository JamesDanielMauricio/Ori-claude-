import type { Transition } from "motion/react";

// The house timing for components animated with the Motion library — the
// JavaScript mirror of the `--ease-*` tokens in globals.css.
//
// The split between the two is by job, not by taste. A hover tint or a press
// scale is a CSS transition: the browser already knows how to interpolate it,
// and a library would add weight for nothing. Motion is for what CSS can't do
// on its own — animating an element OUT before React removes it, collapsing
// the space a deleted row leaves, springs. Both halves read the same curves,
// so if one side changes, change the other, or the app stops feeling like a
// single system.

// Seconds — Motion's unit (CSS durations are written in ms). Everything lands
// in the 150–300ms band: faster than ~150ms reads as a jump cut, and slower
// than ~350ms makes the user wait on the animation before they can act.
export const DURATION = {
  // Small state swaps: a badge's label, a count ticking over.
  fast: 0.15,
  // Most enters and exits.
  base: 0.22,
  // Overlays, and anything that collapses or opens up space.
  slow: 0.3,
} as const;

// `--ease-settle` — for things ENTERING. Fast start, long settle: the element
// is already moving the moment it appears, so it feels responsive.
export const EASE_ENTER = [0.22, 0.61, 0.36, 1] as const;

// `--ease-exit` — for things LEAVING. Slow start, fast finish: it lingers just
// long enough to be seen going, then gets out of the way.
export const EASE_EXIT = [0.4, 0, 1, 1] as const;

export const TRANSITION_ENTER: Transition = { duration: DURATION.base, ease: EASE_ENTER };
export const TRANSITION_EXIT: Transition = { duration: DURATION.base, ease: EASE_EXIT };

// The "pop" for things being ADDED — a new row, a chip, a count changing.
// A spring rather than a bezier because its overshoot comes from physics
// (stiffness pulling toward the target, damping resisting it) instead of a
// hand-drawn curve, so the same values look right on a 12px badge and a
// full-width row. The damping ratio here works out to about 0.64: one small
// visible overshoot, settled in roughly a quarter of a second.
export const SPRING_POP: Transition = { type: "spring", stiffness: 520, damping: 26, mass: 0.8 };
