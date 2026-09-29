import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ProductThumbnail } from "@/components/ui/product-thumbnail";
import { formatVarietyName } from "@/lib/variety-label";

import { formatPrice, type FamilyGroup } from "./catalog-grouping";

// The submission confirmation step (task requirement, not a separate
// screen): a review of exactly what's about to be submitted, built from
// the same family groups the main order screen renders — just grouped
// from the nonzero-quantity subset of the draft instead of the whole
// catalog. See catalog-grouping.ts's header comment.
//
// It looks like the grower's PickConfirmationDialog on purpose: both are the
// same "read it over before it goes" moment, and someone who uses both
// shouldn't have to learn two layouts. So: the same family cards (tinted
// header with the family photo and name, the varieties divided underneath),
// the same scroll area, the same buttons. Only what each row says differs,
// because an order and a pick carry different numbers. The card classes are
// copied from that file rather than shared, so if you change how one of the
// two looks, change the other too (components/grower/pick-confirmation-dialog.tsx).
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
          // Its own scroll area, so the buttons below stay on screen however
          // long the order is. Sized and stacked exactly as in
          // PickConfirmationDialog, whose comment explains each part: `55dvh`
          // to fit inside the dialog's own 85dvh cap on a phone, the 4px
          // padding (offset by the negative margin) so the cards' shadow isn't
          // clipped at the edges, and `space-y` rather than `flex flex-col
          // gap` so a card can't be squashed to fit — the list scrolls instead.
          <div className="-m-1 max-h-[55dvh] space-y-3 overflow-y-auto p-1">
            {families.map((family) => (
              <section
                key={family.familyId}
                className="overflow-hidden rounded-xl bg-surface shadow-card ring-1 ring-inset ring-border/70"
              >
                <div className="flex items-center gap-2.5 border-b border-border/70 bg-surface-muted/50 px-4 py-3">
                  <ProductThumbnail imageUrl={family.imageUrl} size="sm" />
                  <h3 className="min-w-0 flex-1 break-words text-sm font-semibold text-ink">
                    {family.familyName}
                  </h3>
                </div>
                <ul>
                  {family.varieties.map((variety) => (
                    <li
                      key={variety.variety_id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/60 px-4 py-3 last:border-b-0"
                    >
                      {/* Wraps rather than truncating, and `min-w-32` rather
                          than `min-w-0` so the name keeps a floor before the
                          figures drop onto their own line — the same reasoning
                          as the pick dialog's row. Someone checking an order
                          needs the whole name: two sizes of one variety differ
                          only at the end of it. */}
                      <span className="min-w-32 flex-1 break-words text-sm font-medium text-ink">
                        {formatVarietyName(variety.variety_name, variety.sizes)}
                        {!variety.is_orderable && (
                          <span className="ms-2 text-xs text-danger">(אזל מהמלאי)</span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-4">
                        {formatPrice(variety) && (
                          <span className="text-sm text-ink-muted">{formatPrice(variety)}</span>
                        )}
                        {/* The quantity, typeset like the pick dialog's figures:
                            a bold tabular number with its label small and
                            quiet beside it. The space between the two spans is
                            a real text node, so it reads "12 פלטות", not
                            "12פלטות". */}
                        <span className="text-sm">
                          <span className="font-semibold tabular-nums text-ink">
                            {variety.pallets_ordered}
                          </span>{" "}
                          <span className="text-xs text-ink-subtle">פלטות</span>
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
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
