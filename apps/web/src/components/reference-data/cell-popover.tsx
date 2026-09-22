import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { inputClassName } from "@/components/reference-data/form-field";
import { Icon } from "@/components/ui/icon";

// A trigger button plus a panel that opens over the page, for the one kind
// of field a table cell can't hold inline: a list (a grower's in-season
// varieties, a user's blocked products, a product's per-customer caps).
//
// Portaled to <body> and positioned with `fixed`, not absolutely inside the
// cell — the record table is a horizontally scrolling `overflow-auto`
// container, which clips any absolutely-positioned child. That's the same
// reason the sidebar's calendar (trading-day-calendar-picker.tsx) portals
// too, and this reuses its click-outside/Escape handling wholesale.

// Breathing room kept between the panel and either edge of the viewport —
// the same 8px ui/select.tsx uses for its own floating list.
const VIEWPORT_MARGIN = 8;
// The narrowest this panel is allowed to be squeezed to. Below about this,
// the label/value rows inside stop being usable, so the panel slides along
// the viewport instead of shrinking further. See openPanel.
const MIN_PANEL_WIDTH = 240;

export function CellPopover({
  label,
  summary,
  children,
  panelClassName = "w-80",
}: {
  // The control's accessible name, e.g. "מוצרים בעונה".
  label: string;
  // What the closed trigger shows — a count, usually.
  summary: ReactNode;
  children: ReactNode;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    right: number;
    maxWidth: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function openPanel() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Anchored under the trigger and aligned to its inline start (the
      // right edge, in this RTL app), then clamped at BOTH edges.
      //
      // `Math.max(8, …)` alone only held the right edge. Nothing held the
      // left: the panel's width is fixed by `panelClassName`, so on a narrow
      // viewport its left edge is wherever `innerWidth − right − width`
      // happens to land, and that goes negative — off-screen — as soon as
      // the trigger sits any distance from the right edge. The products
      // screen passes `w-[26rem]` (416px), which cannot fit a 375px phone at
      // any offset at all.
      //
      // So: first cap `right` so at least MIN_PANEL_WIDTH of panel is always
      // on screen, then hand the panel a `maxWidth` for the room that
      // actually remains. A panel narrower than its class asks for is the
      // correct outcome — its contents are flex rows that wrap — and it is
      // strictly better than one positioned off the edge of the screen.
      const right = Math.min(
        Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right),
        Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - MIN_PANEL_WIDTH),
      );
      setPosition({
        top: Math.min(rect.bottom + 6, window.innerHeight - 24),
        right,
        maxWidth: Math.max(MIN_PANEL_WIDTH, window.innerWidth - right - VIEWPORT_MARGIN),
      });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Stopped here so the table's own Escape handler (which cancels the
      // whole row edit) doesn't also fire — closing this panel is what the
      // user meant by the first Escape, and losing the row's other unsaved
      // edits to the same keypress would be a nasty surprise.
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    // Capture phase, so this runs before the window-level listener the
    // record table installs (bubble phase, on window) — see above.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        // Wears the same skin as a <select> — it IS one, functionally, so
        // it should not look like a button that happens to sit in a field's
        // place. `flex` overrides the skin's inline-block so the chevron can
        // be pushed to the inline end.
        className={`${inputClassName} flex min-w-[7rem] items-center justify-between gap-2`}
      >
        <span className="truncate">{summary}</span>
        <Icon name="chevronDown" className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            // Dropdowns inside this panel (ui/select.tsx) mount their option
            // list in here rather than in <body>, so picking an option isn't a
            // click "outside" this panel that closes it.
            data-portal-root=""
            style={{
              position: "fixed",
              top: position.top,
              right: position.right,
              maxWidth: position.maxWidth,
            }}
            className={`z-50 max-h-[60dvh] overflow-y-auto rounded-xl border border-border bg-surface p-3 text-ink shadow-overlay ${panelClassName}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-[0.08em] text-ink-subtle">
                {label}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="סגור"
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-danger"
              >
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
            </div>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

// The read-only half of a list-valued cell: every item, always, inside a
// fixed-height scroll box. A cell can't grow to fit thirty varieties
// without wrecking the row rhythm, and truncating to "3 + 27 more" would
// put the information back behind a click — which is the whole thing this
// table exists to avoid. Scrolling inside the cell keeps every value
// reachable without the row changing height.
export function CellChipList({
  items,
  emptyLabel,
  tone = "neutral",
}: {
  items: string[];
  emptyLabel: string;
  tone?: "neutral" | "danger";
}) {
  if (items.length === 0) {
    return <span className="text-sm text-ink-subtle">{emptyLabel}</span>;
  }

  return (
    <div className="flex max-h-16 w-56 flex-wrap gap-1 overflow-y-auto">
      {items.map((item) => (
        <span
          key={item}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            tone === "danger"
              ? "bg-danger-soft text-danger ring-danger/25"
              : "bg-surface-muted text-ink ring-border"
          }`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}
