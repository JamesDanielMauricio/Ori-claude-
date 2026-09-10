import type { ReactNode } from "react";

import { Button } from "../ui/button";

// Pinned, the bar is drawn as a floating toolbar rather than as the
// full-bleed strip the in-flow version is. Two reasons, both visual:
//
// `self-start` shrinks it to its own buttons. Stretched to the content
// width it was a wide empty band carrying one small control, and on a page
// whose every other element is a rounded card floating on ivory, a flat
// edge-to-edge slab under a hairline read as an unfinished wireframe rather
// than a deliberate object.
//
// The edge is `border-strong`, not the usual hairline, and it is doing the
// work the shadow can't. This bar floats over a card that is itself
// near-white, so a white panel with a soft warm shadow — which reads
// perfectly against the ivory canvas everywhere else in the app — turned
// into a ghost the moment it crossed the catalogue: same value, same hue,
// no boundary. `border-strong` is the token meant for exactly this ("edges
// that carry meaning on their own"), and it is what keeps the bar legible
// on white card and ivory page alike. Translucency was tried here and is
// deliberately absent for the same reason: blurred white over flat white
// buys no depth cue and costs contrast.
//
// This also retires the old `after:` background extender — a strip painting
// over the scrollport's bottom padding only made sense while the bar was
// pretending to BE the bottom edge of the page; something that visibly
// floats is allowed to have content under it.
const STICKY_CLASSES =
  "sticky bottom-4 z-10 mt-3 rounded-xl bg-surface p-3 shadow-float ring-1 ring-inset ring-border-strong";

// The "delete, edit, discard & save" reusable the PRD documents on every
// one of the five management screens — one real component instead of six
// near-identical Bubble copies (R1). `editing` toggles which buttons show,
// exactly like the source's `edit?` state, but driven by real React state
// in the parent, not a per-screen custom state.
export function ActionBar({
  editing,
  saving = false,
  dirty = true,
  canDelete = true,
  sticky = false,
  onEdit,
  onDiscard,
  onSave,
  onDelete,
  extra,
}: {
  editing: boolean;
  saving?: boolean;
  // Whether the draft actually differs from what the server holds. Both
  // buttons in the editing branch act on that difference, so with nothing
  // changed there is nothing for either to do: "שמור" would write the values
  // already stored, "בטל שינויים" would restore the ones already on screen.
  // Greying them out says so before the click, instead of after — and on the
  // produce editors, where a save re-submits an entire order or pick, a
  // no-op save is not free: it re-stamps submitted_at and can fire a
  // notification for a change nobody made.
  //
  // Defaults to true — i.e. to the always-clickable behaviour every one of
  // these bars had before — so a future screen that forgets to pass it gets
  // a harmless extra save rather than a permanently dead save button.
  //
  // NOT applied to "מחק": deleting a record has nothing to do with whether
  // its form has unsaved edits.
  dirty?: boolean;
  canDelete?: boolean;
  // Pins the bar to the bottom of whatever is scrolling it, instead of
  // leaving it at the end of the content. The reference-data screens are
  // short forms where the bar is on screen anyway; the two produce editors
  // are not — a customer's order is the whole day's catalogue, several
  // hundred rows, and "save" sitting under all of it meant scrolling past
  // everything to commit a change made at the top. See STICKY_CLASSES for
  // why pinning also changes how the bar is drawn.
  sticky?: boolean;
  // Optional, because not every host has a browse mode to return to. A host
  // that decides editability from something outside this bar — the customer
  // order screen reads it off the trading day's phase — is never in the
  // `editing === false` branch at all, and a "ערוך" button there would be a
  // control for a state that screen cannot enter. Omitting it renders no
  // such button rather than one wired to nothing.
  onEdit?: (() => void) | undefined;
  onDiscard: () => void;
  onSave: () => void;
  onDelete?: (() => void) | undefined;
  extra?: ReactNode | undefined;
}) {
  return (
    // Keyed on `editing` so React remounts the row when the mode flips, which
    // is what lets the entrance animation replay. Without the key the two sets
    // of buttons swap in place with no transition and the mode change is easy
    // to miss — which matters here, because "am I editing?" is exactly the
    // question this bar exists to answer.
    <div
      key={editing ? "editing" : "idle"}
      className={`animate-rise-in flex flex-wrap items-center gap-2 ${
        sticky ? STICKY_CLASSES : "mt-1 border-t border-border pt-4"
      }`}
    >
      {editing ? (
        <>
          <Button type="button" onClick={onSave} disabled={saving || !dirty}>
            {/* A spinning ring during the save, not just the word "שומר…".
                The text alone changes by two characters and is easy to miss;
                a moving element is unambiguous proof the click registered. */}
            {saving && (
              <span
                aria-hidden
                className="animate-spin-loop h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {saving ? "שומר…" : "שמור"}
          </Button>
          {/* Discard is greyed out with nothing to discard — EXCEPT on a bar
              that has a browse mode, where this button is also the only way
              back to it. Disabling it there would strand anyone who pressed
              "ערוך", changed their mind, and changed nothing: a form with two
              dead buttons and no exit. `onEdit` is exactly the signal for
              that, since a bar only has a browse mode if it has a way in. */}
          <Button
            type="button"
            variant="secondary"
            onClick={onDiscard}
            disabled={saving || (!dirty && !onEdit)}
          >
            בטל שינויים
          </Button>
        </>
      ) : (
        <>
          {onEdit && (
            <Button type="button" variant="secondary" onClick={onEdit}>
              ערוך
            </Button>
          )}
          {onDelete && (
            <Button type="button" variant="danger" onClick={onDelete} disabled={!canDelete}>
              מחק
            </Button>
          )}
        </>
      )}
      {extra}
    </div>
  );
}
