import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

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

  // Rendered into <body> rather than wherever it was declared. A modal is
  // conceptually a sibling of the app, not a child of the panel that opened
  // it — and here that is load-bearing, not tidiness: the alerts bell and the
  // day-lifecycle panel both live inside the dark rail, which re-points the
  // color tokens for its whole subtree (see globals.css). A dialog left in
  // that subtree would inherit the dark palette and render as a black modal
  // over a paper page. Portalling to <body> puts it back on the default
  // paper tokens with no per-component override.
  //
  // React still routes events through the React tree, so callbacks passed in
  // by the opening component keep working exactly as before.
  return createPortal(
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
      //
      // `overflow-hidden` is what lets the header's tinted bar meet the
      // dialog's rounded corners cleanly — without it the square-cornered
      // header paints over the radius.
      className="m-auto w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-xl border border-border bg-surface p-0 text-ink shadow-overlay backdrop:bg-ink/50"
    >
      {/* A brass hairline along the very top edge — the one place the second
          brand color appears in the chrome. It gives the modal a "front", so
          it reads as a distinct object over the page rather than as another
          card that happens to float, without tinting the whole header. */}
      <div className="relative flex items-center justify-between gap-4 border-b border-border bg-surface-muted px-6 py-4">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-brass/70" />
        <h2 className="font-display text-xl">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="סגור"
          // 32px box around a 16px glyph: the old bare "×" was roughly a
          // 12px tap target, well under the ~24px minimum, and sat with no
          // visible bounds so there was nothing to aim at. The 90° spin on
          // hover is the cheapest way to confirm the target is live before
          // the click lands.
          className="-me-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-[background-color,color,transform] duration-200 hover:rotate-90 hover:bg-surface hover:text-danger"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>
      <div className="px-6 py-5">{children}</div>
    </dialog>,
    document.body,
  );
}
