import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icon } from "./icon";

// Built on the native <dialog> element rather than a hand-rolled overlay:
// focus trapping, Escape-to-close, and the ::backdrop are all native
// browser behavior, not something we have to reimplement or keep in sync
// with RTL manually. (The open/close animation and the backdrop blur are
// styled in globals.css, which is where anything that has to target
// `dialog[open]::backdrop` has to live — a pseudo-element can't be reached
// from a className here.)
// Width steps. `md` is the original max-w-lg every existing caller was
// written against, so it stays the default and nothing they render moves.
// `lg` exists for the arrangement board's order popup, which mounts the same
// catalog editor the full-page order screen does — at 32rem its price/pallet/
// comment row wraps into a column and stops being scannable.
const SIZE_CLASSES = {
  md: "max-w-lg",
  lg: "max-w-3xl",
} as const;

export function Dialog({
  open,
  onClose,
  title,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: keyof typeof SIZE_CLASSES;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // The heading IS the dialog's accessible name — without this link the
  // modal is announced as an unnamed dialog, and nothing on the page can
  // address it by what it says it is (a test included).
  const titleId = useId();

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
  // day-lifecycle panel both live inside the sidebar, which re-points the
  // color tokens to its own palette for its whole subtree (see globals.css).
  // A dialog left in that subtree would inherit the sidebar's palette instead
  // of the page's — in dark mode, a near-black modal over a charcoal page.
  // Portalling to <body> puts it back on the page's tokens for the current
  // theme, with no per-component override.
  //
  // React still routes events through the React tree, so callbacks passed in
  // by the opening component keep working exactly as before.
  return createPortal(
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={handleBackdropClick}
      aria-labelledby={titleId}
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
      // `max-h-[85dvh]` + a scrolling body, because a dialog is not
      // guaranteed to be short. Every modal in the app used to be a handful
      // of fields, so nothing had ever overflowed; the arrangement board's
      // order popup mounts the whole day's catalogue and ran straight off the
      // bottom of the viewport with its own save button unreachable and no
      // way to scroll to it. The cap belongs here rather than in that one
      // caller — any dialog can grow, and none of them should be able to put
      // their controls out of reach.
      //
      // `open:flex`, never a bare `flex`. A closed <dialog> is hidden by the
      // UA stylesheet's `dialog:not([open]) { display: none }`, and an author
      // `display: flex` beats it — so setting it unconditionally paints every
      // mounted-but-closed dialog into the page. This screen mounts two of
      // them at all times, and both appeared as stray form fragments below
      // the board until the variant was added.
      //
      // `backdrop:bg-scrim`, not a faded `ink`: in the dark theme `ink` is
      // near-white, and the page behind a modal would turn pale instead of dim.
      className={`m-auto max-h-[85dvh] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface p-0 text-ink shadow-overlay backdrop:bg-scrim open:flex ${SIZE_CLASSES[size]}`}
    >
      {/* `py-3`, paired with the 40px close button below, keeps this header
          the same 64px it was when the button was 32px and the padding was
          `py-4` — the button grew into the padding rather than on top of it,
          so no dialog in the app changes height. */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-surface-muted px-6 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="סגור"
          // 40px box around a 16px glyph. The old bare "×" was roughly a 12px
          // tap target; the box brought that to 32px, which clears WCAG's
          // 24px floor but not the ~40px this app builds its controls to —
          // and on a phone this is the visible way out of every modal the
          // customer and grower screens open. The 90° spin on hover is the
          // cheapest way to confirm the target is live before the click
          // lands.
          className="-me-2.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink-muted transition-[background-color,color,transform] duration-200 hover:rotate-90 hover:bg-surface hover:text-danger"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>
      {/* The scrolling part. `min-h-0` is what actually lets it shrink: a
          flex child defaults to `min-height: auto`, which refuses to go below
          its content's height and would push the overflow back outside the
          dialog no matter what the cap above says. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
    </dialog>,
    document.body,
  );
}
