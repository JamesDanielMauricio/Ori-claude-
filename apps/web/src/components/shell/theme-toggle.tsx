import { useId } from "react";

import { Icon, type IconName } from "@/components/ui/icon";
import { setThemePreference, useThemePreference, type ThemePreference } from "@/lib/theme";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: IconName }> = [
  { value: "light", label: "בהיר", icon: "sun" },
  { value: "dark", label: "כהה", icon: "moon" },
  { value: "system", label: "מערכת", icon: "monitor" },
];

// Light / dark / system, as a three-way segmented control.
//
// Real radio inputs underneath, visually hidden, so it behaves like the radio
// group it is with no hand-written keyboard code: Tab lands on the selected
// option, the arrow keys move between options, and a screen reader announces
// the group's name and "2 of 3". The visible segment is the <label>, so
// clicking anywhere on it selects.
//
// Sits in the sidebar footer of all three shells, which is why it styles
// itself with the ordinary tokens — inside the sidebar they already resolve to
// the sidebar's palette for the current theme. Its selected state is the
// sidebar's own selection idiom (soft accent tint + accent text, the same as
// the current nav row).
export function ThemeToggle() {
  const preference = useThemePreference();
  // One group name per mounted copy. The desktop rail and the mobile menu can
  // both be in the DOM at once, and radios that share a `name` form a single
  // group — two toggles would behave as one group of six.
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-label="ערכת צבעים"
      className="grid grid-cols-3 gap-1 rounded-lg bg-surface-muted p-1 ring-1 ring-inset ring-border"
    >
      {OPTIONS.map((option) => {
        const selected = preference === option.value;
        return (
          <label
            key={option.value}
            // The focus ring goes on the label, because the input it belongs to
            // is visually hidden and its own outline would be invisible.
            // `relative` anchors that hidden (absolutely positioned) input
            // inside its own label — the mobile menu is a scroll area, and an
            // input anchored outside it wouldn't move when the menu scrolls.
            className={`relative flex h-8 cursor-pointer select-none items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-[background-color,color] duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent-bright ${
              selected
                ? "bg-accent-soft text-accent ring-1 ring-inset ring-accent/25"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => setThemePreference(option.value)}
              className="sr-only"
            />
            <Icon name={option.icon} className="h-4 w-4 shrink-0" />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
