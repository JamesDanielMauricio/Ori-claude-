import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

// Filled variants darken on hover (a real -hover token) instead of the old
// `hover:opacity-90`. Fading a filled control toward the page behind it makes
// it look disabled rather than hovered — the opposite of the signal intended —
// and it also washes out the label's contrast at the moment the user is
// aiming at it.
//
// Each filled variant also carries a 1px inset top highlight
// (`inset_0_1px_0_0_rgb(255_255_255/…)`). That single line is what stops a
// flat rectangle of color from looking like a sticker: it mimics light
// catching the top edge, which is the same cue the shadow underneath implies.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink shadow-accent shadow-[inset_0_1px_0_0_rgb(255_255_255/0.18)] hover:bg-accent-hover",
  // `ring` instead of `border`, so the outline sits inside the box and the
  // secondary button is the exact same height as the primary beside it —
  // a 1px border makes it 2px taller, which is visible in a button row.
  secondary:
    "bg-surface text-ink shadow-card ring-1 ring-inset ring-border-strong hover:bg-surface-muted hover:ring-accent/40 hover:text-accent",
  ghost: "text-ink-muted hover:bg-accent-soft/70 hover:text-accent",
  // `danger-ink`, not white: on the dark palettes (the dark theme and the
  // dark sidebar) the red is a light coral, and white text on it drops to
  // ~3:1.
  danger: "bg-danger text-danger-ink shadow-card hover:bg-danger-hover",
};

// Fixed heights rather than padding-derived ones, so a row of buttons lines
// up even when one of them holds a different glyph (the "←"/"+" prefixes
// several screens use) or a spinner ellipsis. Both sizes gained ~2px of
// height and noticeably more horizontal padding: cramped buttons are one of
// the most reliable tells of a template, and these sit in a layout that now
// has the room.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  // 36px, not 32px: below the ~40px touch-target guideline on its own, but
  // `sm` is reserved for secondary/inline actions rather than a screen's
  // primary CTA, and pushing it all the way to 40px started crowding the
  // button rows that use two or three of these side by side.
  sm: "h-9 gap-1.5 px-3.5 text-xs",
  md: "h-10 gap-2 px-5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  // Additive and defaulted to the size every existing caller already
  // renders, so no screen changes appearance by not passing it.
  size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      // The press physics are `translate-y` + a shortened transition, not a
      // color change: a 1px drop on `active` is read as "the control moved
      // under my finger" far more reliably than any tint, and because it is a
      // transform it costs the compositor nothing. Hover lifts by the same
      // 1px in the opposite direction on the filled variants, so the pair
      // reads as one physical object rather than two unrelated states.
      // Disabled is a real style, not `opacity`. Fading a filled green button
      // to 55% over an ivory page produced a pale mint blob with near-invisible
      // white text — it read as a rendering glitch rather than as a control
      // that is off. A flat recessed fill with muted text is unambiguous, and
      // it stays legible on the page and in the sidebar, in either theme
      // (the tokens flip with the surface). The `disabled:` utilities come
      // last in the string but win regardless of order, because none of the
      // variant classes above are themselves `disabled:`-scoped.
      className={`group relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-semibold transition-[background-color,box-shadow,transform,color] duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)] enabled:active:translate-y-px enabled:active:duration-75 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-subtle disabled:shadow-none disabled:ring-1 disabled:ring-inset disabled:ring-border ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
