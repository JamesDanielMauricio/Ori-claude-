import type { ReactNode } from "react";

// A hand-rolled stroke-icon set, deliberately not an icon-library
// dependency: the app needs about fifteen glyphs, and a package would ship
// hundreds plus a tree-shaking story to worry about.
//
// This replaces the emoji the sidebar used to render (🛒 📋 🌱 …). Emoji are
// a *font*, not artwork — they arrive full-color, at the platform's own
// weight, and look materially different on Windows, macOS, Android and
// Linux, so the one part of the UI that is always on screen was the part we
// had least control over. These are strokes in `currentColor`, so a nav item
// tints with its own text (muted when idle, accent when active) for free.
//
// Every glyph is drawn on the same 24×24 grid at the same stroke width, which
// is what makes a set look like a set rather than a pile of clip art.
const PATHS: Record<string, ReactNode> = {
  cart: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17.5" cy="20" r="1.4" />
      <path d="M2.5 4h2.2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.55L20.2 8H6" />
    </>
  ),
  clipboard: (
    <>
      <rect x="4.5" y="4.5" width="15" height="16.5" rx="2.5" />
      <rect x="9" y="2.5" width="6" height="4" rx="1.3" />
      <path d="M8.5 11.5h7M8.5 15.5h7" />
    </>
  ),
  plusCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 1.9" />
    </>
  ),
  package: (
    <>
      <path d="M20.5 7.9v8.2a1.8 1.8 0 0 1-.95 1.6l-6.7 3.6a1.8 1.8 0 0 1-1.7 0l-6.7-3.6a1.8 1.8 0 0 1-.95-1.6V7.9a1.8 1.8 0 0 1 .95-1.6l6.7-3.6a1.8 1.8 0 0 1 1.7 0l6.7 3.6a1.8 1.8 0 0 1 .95 1.6Z" />
      <path d="m3.7 7.1 8.3 4.5 8.3-4.5" />
      <path d="M12 21.1v-9.5" />
    </>
  ),
  sprout: (
    <>
      <path d="M12 21v-7.2" />
      <path d="M12 13.8c0-3.4 2.8-6.1 6.2-6.1 0 3.4-2.8 6.1-6.2 6.1Z" />
      <path d="M12 13.8c0-2.9-2.3-5.2-5.2-5.2 0 2.9 2.3 5.2 5.2 5.2Z" />
    </>
  ),
  users: (
    <>
      <circle cx="9.3" cy="8.2" r="3.3" />
      <path d="M3.4 20a5.9 5.9 0 0 1 11.8 0" />
      <path d="M16.6 5.6a3.1 3.1 0 0 1 0 5.9" />
      <path d="M18.2 14.4a5.4 5.4 0 0 1 2.4 4.5" />
    </>
  ),
  truck: (
    <>
      <rect x="1.8" y="6" width="11.4" height="10" rx="1.6" />
      <path d="M13.2 9.6h3.5l3.5 3.4V16h-7z" />
      <circle cx="6.6" cy="18.4" r="1.9" />
      <circle cx="16.8" cy="18.4" r="1.9" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.4 20.2a6.6 6.6 0 0 1 13.2 0" />
    </>
  ),
  leaf: (
    <>
      <path d="M20.2 3.8c0 8.4-4.6 12.7-10.1 12.7A5.1 5.1 0 0 1 5 11.4C5 5.8 9.6 3.8 20.2 3.8Z" />
      <path d="M4 20.2c2.6-4.6 6.1-7.6 10.2-9.2" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7.4" width="18" height="12.8" rx="2.2" />
      <path d="M9 7.4V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.4" />
      <path d="M3 12.6h18" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9.8a6 6 0 1 0-12 0c0 4.9-2 6.4-2 6.4h16s-2-1.5-2-6.4Z" />
      <path d="M13.7 19.4a2 2 0 0 1-3.4 0" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="m6.8 6.8 10.4 10.4M17.2 6.8 6.8 17.2" />,
  // A lid, a can, and the ribs inside it — the record-table's delete
  // button, the first place this app has needed a delete GLYPH rather than
  // a text "מחק" button.
  trash: (
    <>
      <path d="M4.5 7.5h15" />
      <path d="M9.5 7.5V5.8a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7.5" />
      <path d="M6.5 7.5 7.3 19a1.8 1.8 0 0 0 1.8 1.7h5.8a1.8 1.8 0 0 0 1.8-1.7l.8-11.5" />
      <path d="M10.3 11v6M13.7 11v6" />
    </>
  ),
  // Three sliders at different heights — the record-table's
  // column-visibility toggle.
  columns: (
    <>
      <path d="M5 4.5v15M12 4.5v15M19 4.5v15" />
      <circle cx="5" cy="9" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="19" cy="7" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  // Points toward the inline start of an RTL page, i.e. visually right —
  // the "back" direction in Hebrew.
  chevronStart: <path d="m9.5 5 7 7-7 7" />,
  // Expand/collapse affordance — direction-agnostic (unlike chevronStart),
  // so it doesn't need an RTL-aware name.
  chevronDown: <path d="m5 9 7 7 7-7" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.4 12.3 2.5 2.5 4.7-5" />
    </>
  ),
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.8v4.7" />
      <path d="M12 16.1h.01" />
    </>
  ),
  infoCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11.4v4.7" />
      <path d="M12 8h.01" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.2" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3.5v3M16 3.5v3" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m19.5 19.5-4.3-4.3" />
    </>
  ),
  // Drawn on the same 24×24 grid as the rest: a nib and its shaft on the
  // 45° diagonal, plus the short "ink" stroke that reads as the tip. Added
  // for the arrangement board, where every editable row carries one.
  pencil: (
    <>
      <path d="M4.5 19.5h3.2L18.4 8.8a2.26 2.26 0 0 0-3.2-3.2L4.5 16.3z" />
      <path d="m14.2 6.6 3.2 3.2" />
    </>
  ),
  // The theme toggle's three options: light, dark, and "follow the device".
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 2.8v1.9M12 19.3v1.9M2.8 12h1.9M19.3 12h1.9M5.5 5.5l1.35 1.35M17.15 17.15l1.35 1.35M5.5 18.5l1.35-1.35M17.15 6.85l1.35-1.35" />
    </>
  ),
  moon: <path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a7 7 0 0 0 9.7 9.7Z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2.2" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

// Decorative by default: every icon in this app sits beside its own text
// label (nav rows, toasts) or inside a control that already carries an
// aria-label (the bell, the hamburger). `aria-hidden` keeps screen readers
// from announcing a second, redundant name for the same thing.
export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
