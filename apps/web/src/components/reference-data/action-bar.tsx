import type { ReactNode } from "react";

import { Button } from "../ui/button";

// The "delete, edit, discard & save" reusable the PRD documents on every
// one of the five management screens — one real component instead of six
// near-identical Bubble copies (R1). `editing` toggles which buttons show,
// exactly like the source's `edit?` state, but driven by real React state
// in the parent, not a per-screen custom state.
export function ActionBar({
  editing,
  saving = false,
  canDelete = true,
  onEdit,
  onDiscard,
  onSave,
  onDelete,
  extra,
}: {
  editing: boolean;
  saving?: boolean;
  canDelete?: boolean;
  onEdit: () => void;
  onDiscard: () => void;
  onSave: () => void;
  onDelete?: (() => void) | undefined;
  extra?: ReactNode | undefined;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-border pt-4">
      {editing ? (
        <>
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving ? "שומר…" : "שמור"}
          </Button>
          <Button type="button" variant="secondary" onClick={onDiscard} disabled={saving}>
            בטל שינויים
          </Button>
        </>
      ) : (
        <>
          <Button type="button" variant="secondary" onClick={onEdit}>
            ערוך
          </Button>
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
