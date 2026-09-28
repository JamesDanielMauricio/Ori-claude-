import type { KeyboardEvent } from "react";

import { Icon } from "./icon";

// A `− n +` quantity control with a ceiling — the customer's own order
// screen (order-product-list.tsx, quantityMode="stepper"). It replaced a
// dropdown listing every whole number from 0 to the row's cap, which on a
// phone meant opening a list and scrolling it to change 3 into 4.
//
// The number in the middle is a real text field, so a large quantity can be
// typed instead of tapped out one at a time. It is a text field and not
// `type="number"` on purpose: a number field accepts "1e3", "-2" and "4.5",
// and on desktop the scroll wheel changes it silently (see
// lib/integer-input.ts). Here anything that isn't a digit is simply dropped.
//
// The ceiling is the same rule the dropdown had. A customer can never pick a
// number above `max`, with one exception: a value ALREADY above it stays
// (stock can drop below a quantity chosen earlier, between page loads) — it
// is shown as-is and can only move down. The dropdown did this by adding the
// current value as an extra option; here `+` is off, `−` drops straight to
// the ceiling (the next number the customer is allowed to hold), and typing
// clamps to it.
//
// Keyboard: Tab reaches the number only. The buttons are left out of the tab
// order — the arrow keys do what they do (↑ adds one, ↓ removes one), which
// is the standard spinbutton pattern and saves two extra Tab stops on every
// one of a catalogue's rows. They stay in the accessibility tree, so a
// screen reader's swipe navigation on a phone still reaches them.
export function QuantityStepper({
  value,
  max,
  onChange,
  disabled = false,
  label,
}: {
  // The draft's own string. "" means nothing ordered and shows as a
  // placeholder "0" — the same thing the dropdown displayed for it.
  value: string;
  max: number;
  onChange: (next: string) => void;
  disabled?: boolean;
  // Accessible name of the number field, e.g. "כמות משטחים — מנגו 18".
  label: string;
}) {
  const current = Number(value) || 0;
  const ceiling = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  const canDecrease = !disabled && current > 0;
  const canIncrease = !disabled && current < ceiling;

  function decrease() {
    // Math.min: from a value above the ceiling, one step down lands on the
    // ceiling rather than on another number the customer isn't allowed.
    if (canDecrease) onChange(String(Math.min(current - 1, ceiling)));
  }

  function increase() {
    if (canIncrease) onChange(String(current + 1));
  }

  function handleTyped(raw: string) {
    const digits = raw.replace(/\D/g, "");
    // Emptying the field is allowed while typing — otherwise there would be
    // no way to replace "4" with "7" by deleting first. "" is a valid draft
    // value everywhere (it counts as 0).
    if (digits === "") {
      onChange("");
      return;
    }
    const typed = Number(digits);
    onChange(String(typed === current ? typed : Math.min(typed, ceiling)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      increase();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      decrease();
    }
  }

  // Shared by both buttons. 40×40: this control repeats once per catalogue
  // row, stacked, on a phone — the same reason the row's comment button was
  // lifted to 40px tall (see order-product-list.tsx).
  // `touch-manipulation`: two quick taps on "+" are two steps, not a
  // double-tap zoom — which mobile browsers otherwise may read them as.
  const buttonClassName =
    "flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-md text-ink-muted transition-colors duration-150 enabled:hover:bg-accent-soft/70 enabled:hover:text-accent enabled:active:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40";

  return (
    // The field skin's own fill, outline and focus halo (form-field.tsx's
    // inputClassName), moved from the <input> to the whole group, so the
    // three parts read as one control and the halo wraps all of it.
    <div
      className={`inline-flex h-10 w-32 items-center rounded-md ring-1 ring-inset transition-[background-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
        disabled
          ? "bg-surface-muted ring-border"
          : "bg-surface-muted shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] ring-border-strong hover:bg-surface focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent-bright focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent-bright)_18%,transparent)]"
      }`}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="הפחת אחד"
        disabled={!canDecrease}
        onClick={decrease}
        className={buttonClassName}
      >
        <Icon name="minus" className="h-4 w-4" />
      </button>
      {/* `field-control` is what lifts this to 16px on touch screens, where
          anything smaller makes Mobile Safari zoom the page on focus (see
          globals.css). `min-w-0 flex-1`: the field takes whatever the two
          buttons leave — 48px of the 128. */}
      <input
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(ceiling, current)}
        aria-valuenow={current}
        placeholder="0"
        disabled={disabled}
        value={value}
        onChange={(event) => handleTyped(event.target.value)}
        onKeyDown={handleKeyDown}
        // Tapping into "0" and typing 5 should give 5, not "05" — select the
        // whole number so the first keystroke replaces it.
        onFocus={(event) => event.currentTarget.select()}
        // `placeholder:text-current`: an untouched row's "0" looks exactly
        // like a chosen 0 — both mean the same thing, and the dropdown drew
        // them identically.
        className="field-control h-full min-w-0 flex-1 bg-transparent text-center text-sm font-semibold text-ink tabular-nums placeholder:text-current focus:outline-none disabled:cursor-not-allowed disabled:text-ink-muted"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="הוסף אחד"
        disabled={!canIncrease}
        onClick={increase}
        className={buttonClassName}
      >
        <Icon name="plus" className="h-4 w-4" />
      </button>
    </div>
  );
}
