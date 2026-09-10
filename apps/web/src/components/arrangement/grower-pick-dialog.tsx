import { PickLinesEditor } from "@/components/grower/pick-lines-editor";
import { Dialog } from "@/components/ui/dialog";

// The popup behind the pencil on a grower's row, and the exact counterpart
// of CustomerOrdersDialog on the other side of the board.
//
// It edits the grower's PICK — what they actually brought — which is the
// supply half of every figure on the screen. Correcting it mid-arrangement
// is routine: a grower rings to say a pallet was short, or the count was
// keyed wrong, and the distributor needs the ✓ buttons opposite to start
// validating against the real number.
//
// Deliberately not a new editor, and deliberately not a link. It mounts the
// same PickLinesEditor the grower's own screen and the "בשם מגדל" oversight
// screen use (save_pick_lines accepts "the owning grower, or backoffice"),
// and it does it here rather than navigating there, because the distributor
// is working one pick line down a list of customers — leaving the page to
// fix a pallet count would lose the selection, the promoted customers and
// the scroll position, and they would have to rebuild all of it to carry on.
export function GrowerPickDialog({
  pickId,
  pickStatus,
  growerName,
  onClose,
  onSaved,
  readOnly = false,
}: {
  pickId: string | null;
  // Widened from the editor's own union because the board reads `status` off
  // a PostgREST row as a bare string. Anything unexpected is treated as
  // closed, which makes the editor read-only — the safe direction to fail
  // for a control that writes to the day's supply.
  pickStatus: string;
  growerName: string;
  onClose: () => void;
  onSaved: () => void;
  // Forwarded straight through to PickLinesEditor's own `readOnly` — see
  // that prop's comment for why it can't simply be inferred from
  // `pickStatus`: the board passes this whenever the sidebar's date picker
  // has pinned a day other than the live one, which includes the one case
  // `pickStatus` can't catch on its own (pinning the live day's own date).
  readOnly?: boolean;
}) {
  const status =
    pickStatus === "draft" || pickStatus === "submitted" || pickStatus === "closed"
      ? pickStatus
      : "closed";

  return (
    <Dialog
      open={pickId !== null}
      onClose={onClose}
      title={`מלאי — ${growerName}`}
      // The editor is a table of pallets / pickup time / comment per
      // variety; at the default width those three columns stop fitting.
      size="lg"
    >
      {/* Keyed by pick so moving from one grower's pencil to another's
          remounts the editor rather than showing the previous grower's
          draft under the new one's name. */}
      {pickId !== null && (
        <PickLinesEditor
          key={pickId}
          dailyPickId={pickId}
          pickStatus={status}
          onSaved={onSaved}
          // Keeps "שמור" pinned to the bottom of the popup instead of
          // wherever the line list happens to end — this dialog is a fixed
          // scroll area, so an in-flow bar would be a scroll away from where
          // the distributor is actually looking.
          sticky
          readOnly={readOnly}
        />
      )}
    </Dialog>
  );
}
