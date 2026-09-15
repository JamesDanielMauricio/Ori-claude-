import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatVarietyName } from "@/lib/variety-label";

import { formatPrice, type FamilyGroup } from "./catalog-grouping";

// The submission confirmation step (task requirement, not a separate
// screen): a review of exactly what's about to be submitted, built from
// the same family groups the main order screen renders — just grouped
// from the nonzero-quantity subset of the draft instead of the whole
// catalog. See catalog-grouping.ts's header comment.
export function SubmissionConfirmationDialog({
  open,
  families,
  confirming,
  onClose,
  onConfirm,
}: {
  open: boolean;
  families: FamilyGroup[];
  confirming: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="אישור הזמנה">
      <div className="flex flex-col gap-4">
        {families.length === 0 ? (
          <p className="text-sm text-ink-muted">ההזמנה ריקה — לא נבחרו כמויות.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {families.map((family) => (
              <div key={family.familyId} className="mb-3">
                <h3 className="mb-1 text-sm font-semibold">{family.familyName}</h3>
                <ul className="flex flex-col gap-1">
                  {family.varieties.map((variety) => (
                    <li
                      key={variety.variety_id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {formatVarietyName(variety.variety_name, variety.sizes)}
                        {!variety.is_orderable && (
                          <span className="ms-2 text-xs text-danger">(אזל מהמלאי)</span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-3 text-ink-muted">
                        {formatPrice(variety) && <span>{formatPrice(variety)}</span>}
                        <span>{variety.pallets_ordered} פלטות</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={confirming}>
            חזרה לעריכה
          </Button>
          <Button type="button" onClick={onConfirm} disabled={confirming}>
            {confirming ? "שולח…" : "שלח הזמנה"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
