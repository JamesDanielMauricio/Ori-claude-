import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

// Filled variants darken on hover (a real -hover token) instead of the old
// `hover:opacity-90`. Fading a filled control toward the page behind it
// makes it look disabled rather than hovered — the opposite of the signal
// intended — and it also washes out the label's contrast at the moment the
// user is aiming at it.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink shadow-card hover:bg-accent-hover",
  secondary: "border border-border-strong bg-surface text-ink shadow-card hover:bg-surface-muted",
  ghost: "text-ink-muted hover:bg-canvas hover:text-ink",
  danger: "bg-danger text-white shadow-card hover:bg-danger-hover",
};

// Fixed heights rather than padding-derived ones, so a row of buttons lines
// up even when one of them holds a different glyph (the "←"/"+" prefixes
// several screens use) or a spinner ellipsis.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-9 gap-2 px-4 text-sm",
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
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-150 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
