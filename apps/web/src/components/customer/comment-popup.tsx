"use client";

import { useEffect, useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

// The PRD's comment popup (customer-order-comment-popup.md): "intentionally
// minimal... a confirmation button group... the actual comment input is
// bound elsewhere." Interpreted here as the input living INSIDE this
// popup (the simplest reading that still makes the popup a real
// confirm/dismiss gate rather than an empty shell) — opened from an inline
// per-row control, never auto-saving on every keystroke. Confirming writes
// into the caller's local draft state; it never touches the server itself
// — that only happens when the whole order is submitted.
export function CommentPopup({
  open,
  initialValue,
  onClose,
  onConfirm,
}: {
  open: boolean;
  initialValue: string;
  onClose: () => void;
  onConfirm: (comment: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  return (
    <Dialog open={open} onClose={onClose} title="הערה">
      <div className="flex flex-col gap-4">
        <input
          className={inputClassName}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="הוסף הערה…"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button
            type="button"
            onClick={() => {
              onConfirm(value);
              onClose();
            }}
          >
            אישור
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
