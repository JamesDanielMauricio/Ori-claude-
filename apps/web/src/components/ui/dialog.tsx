"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

import { Icon } from "./icon";

// Built on the native <dialog> element rather than a hand-rolled overlay:
// focus trapping, Escape-to-close, and the ::backdrop are all native
// browser behavior, not something we have to reimplement or keep in sync
// with RTL manually. (The open/close animation and the backdrop blur are
// styled in globals.css, which is where anything that has to target
// `dialog[open]::backdrop` has to live — a pseudo-element can't be reached
// from a className here.)
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) {
      onClose();
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={handleBackdropClick}
      // `m-auto` restores the browser default a modal <dialog> relies on to
      // center itself. Tailwind preflight zeroes `margin` on every element,
      // which silently overrides the UA stylesheet rule and left every modal
      // in the app pinned to the top inline-start corner of the viewport.
      // `w-[calc(100%-2rem)]` keeps a gutter on phones, where a max-w-lg
      // dialog would otherwise run edge to edge with its corners cut off.
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-surface p-0 text-ink shadow-overlay backdrop:bg-ink/45"
    >
      <div className="flex items-center justify-between gap-4 border-b border-border bg-surface-muted px-5 py-3.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="סגור"
          // 32px box around a 16px glyph: the old bare "×" was roughly a
          // 12px tap target, well under the ~24px minimum, and sat with no
          // visible bounds so there was nothing to aim at.
          className="-me-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
