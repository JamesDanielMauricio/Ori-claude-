"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

// Built on the native <dialog> element rather than a hand-rolled overlay:
// focus trapping, Escape-to-close, and the ::backdrop are all native
// browser behavior, not something we have to reimplement or keep in sync
// with RTL manually.
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
      className="w-full max-w-lg rounded-lg border border-border bg-surface p-0 text-ink backdrop:bg-ink/40"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="סגור"
          className="rounded p-1 text-ink-muted hover:bg-canvas"
        >
          ×
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
