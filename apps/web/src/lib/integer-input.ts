import type { KeyboardEvent } from "react";

// Shared by every pallet/quantity number input in the app (grower picks,
// customer orders, arrangement records, the arrangement board's allocation
// cells) — none of them take fractional pallets, so none of them should
// accept a decimal point at all.
//
// `step="1"` on its own doesn't do this: a browser's number input still
// lets someone type "8.5" while focused, and only flags it as :invalid on
// blur/submit (which this app doesn't check). Blocking the separator key
// itself is what actually stops it from being typed in the first place.
export function blockDecimalKey(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "." || event.key === ",") {
    event.preventDefault();
  }
}

// Second line of defense for however a decimal could still land in the
// field without a keystroke `blockDecimalKey` would see — a paste, or
// autofill. Keeps only what was typed before the first separator, so
// "8.5" pasted in becomes "8" rather than being accepted whole.
export function stripDecimal(value: string): string {
  const separatorIndex = value.search(/[.,]/);
  return separatorIndex === -1 ? value : value.slice(0, separatorIndex);
}
