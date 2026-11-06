import { useId, useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";

import { formatCustomerScore, parseCustomerScore } from "./customer-score";

// One customer's ranking score, typed straight into the table.
//
// Unlike every other column on the customers screen, this one is not part of
// the row's own edit: it saves by itself, on blur or Enter, the way a cell of
// the arrangement matrix does. Two reasons. A distributor ranking their
// customers works down the column — forty-odd numbers in a row — and opening
// and saving each row to type one would be most of the work. And the score is
// stored and saved apart from the rest of the customer (set_customer_score,
// migration 0067), so a row save that carried it would be two writes posing
// as one.
export function CustomerScoreCell({
  customerName,
  score,
  onSave,
}: {
  customerName: string;
  score: number | null;
  /** Resolves to whether the write landed; a refusal puts the old score back. */
  onSave: (score: number | null) => Promise<boolean>;
}) {
  const shown = formatCustomerScore(score);
  const [draft, setDraft] = useState(shown);
  // Re-seeds when the saved score changes under the box — tracked rather than
  // synced in an effect, so the new figure lands in the same render. Same
  // pattern as the matrix's MatrixMobileInput.
  const [lastSeen, setLastSeen] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  if (lastSeen !== shown) {
    setLastSeen(shown);
    setDraft(shown);
    // The mark belongs to the text it was raised for, and that text is gone.
    setInvalid(false);
  }
  const hintId = useId();

  async function commit() {
    const parsed = parseCustomerScore(draft);
    if (parsed.kind === "invalid") {
      // Left as typed, and marked: silently putting the old score back would
      // look as if the new one had been taken.
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const next = parsed.kind === "score" ? parsed.value : null;
    if (next === score) {
      // "4.50" for a saved 4.5, say: nothing to write, but show it plainly.
      setDraft(shown);
      return;
    }
    const landed = await onSave(next);
    if (!landed) setDraft(shown);
  }

  return (
    <span className="flex flex-col gap-1">
      <input
        type="text"
        inputMode="decimal"
        // Digits read left-to-right inside an RTL page, the same rule every
        // number input in this app follows (see globals.css).
        dir="ltr"
        autoComplete="off"
        aria-label={`דירוג — ${customerName}`}
        aria-invalid={invalid}
        aria-describedby={invalid ? hintId : undefined}
        placeholder="חסר דירוג"
        value={draft}
        className={`${inputClassName} w-28 text-center placeholder:text-ink-subtle ${invalid ? "ring-danger focus:ring-danger" : ""}`}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            // Stopped here so the table's own Escape handler — which cancels
            // whichever row is being edited, on window — does not also fire.
            // Backing out of this box is what the keypress meant; taking
            // another row's unsaved edit with it would be a nasty surprise.
            // Same reason cell-popover.tsx stops it.
            event.stopPropagation();
            setDraft(shown);
            setInvalid(false);
          }
        }}
      />
      {invalid && (
        <span id={hintId} role="alert" className="text-xs text-danger">
          מספר בין 1 ל-5
        </span>
      )}
    </span>
  );
}
