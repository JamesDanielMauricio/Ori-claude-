import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ProductThumbnail } from "@/components/ui/product-thumbnail";

export interface PickReviewFamily {
  familyId: string;
  familyName: string;
  imageUrl: string | null;
  varieties: Array<{
    id: string;
    varietyName: string;
    pallets: number;
    leftover: number;
    comment: string;
  }>;
}

// The review step every "שמור" on a pick goes through — the grower's own
// screen, and the distributor's pencil popup on "בשם מגדל" and on the
// arrangement board. It lists exactly what is about to be saved: the draft on
// screen, keeping only the lines that say something (a quantity or a
// comment). A variety left at zero with no comment is not a picking, and on a
// long in-season list those rows would bury the ones that are.
//
// Grouped into the same family cards the picking screen itself shows (tinted
// header with the family photo and name, varieties divided underneath — see
// PickLinesEditor), so it is recognisably the same pick. The difference is
// deliberate: every family is open and there is no chevron. This is a
// summary to read top to bottom before confirming, and a family that had to
// be opened to be checked is one that would go unchecked.
export function PickConfirmationDialog({
  open,
  families,
  sends,
  confirming,
  onClose,
  onConfirm,
}: {
  open: boolean;
  families: PickReviewFamily[];
  // Whether confirming also SENDS the pick (the grower's own screen, see
  // PickLinesEditor's `submitOnSave`) or only saves it (the distributor's
  // hosts, where sending is the arrangement board's truck icon). Only the
  // wording changes: the button must not say "ושלח" over a save that sends
  // nothing.
  sends: boolean;
  confirming: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const confirmLabel = sends ? "שמור ושלח" : "שמור";
  const pendingLabel = sends ? "שולח…" : "שומר…";

  return (
    <Dialog open={open} onClose={onClose} title="אישור ליקוט">
      <div className="flex flex-col gap-4">
        {families.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {sends ? "לא הוזנו כמויות — הליקוט יישלח ריק." : "לא הוזנו כמויות — הליקוט יישמר ריק."}
          </p>
        ) : (
          // Its own scroll area, so the confirm buttons below stay on screen
          // however long the list is. `55dvh` leaves room for the dialog's
          // header and buttons inside its own 85dvh cap on a phone. The 4px
          // padding (offset by the negative margin) is room for the cards'
          // shadow, which the scroll area would otherwise clip at its edges.
          //
          // Stacked with `space-y`, NOT `flex flex-col gap`: flex items shrink
          // to fit a height-capped container, and a card with
          // `overflow-hidden` is allowed to shrink below its own content — so
          // with a few families open, every card was squashed to part of its
          // first row and the rest was clipped, instead of the list scrolling.
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
                      key={variety.id}
                      className="flex flex-col gap-1 border-b border-border/60 px-4 py-3 last:border-b-0"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        {/* Wraps rather than truncating: this list exists so
                            the grower can check WHICH product each number
                            belongs to, and on a phone a truncated name cut
                            off exactly the part that tells two sizes of one
                            variety apart.

                            `min-w-32`, not `min-w-0`: with three figures
                            beside it, a name allowed to shrink to nothing
                            did — at 320px it was a sliver breaking mid-word,
                            and the figures never wrapped because the name
                            always made room. With a floor, a narrow card
                            moves the figures onto their own line under the
                            name instead (the same way the editor's own rows
                            stack on a phone), and a wide one keeps them all
                            on one line. */}
                        <span className="min-w-32 flex-1 break-words text-sm font-medium text-ink">
                          {variety.varietyName}
                        </span>
                        <span className="flex shrink-0 items-baseline gap-4">
                          <Figure caption="נקטף" value={variety.pallets} />
                          <Figure caption="עודף" value={variety.leftover} />
                          {/* The line's whole supply — what the distributor
                              can actually arrange from it, since carried-over
                              leftover counts as real stock alongside the
                              fresh pick (the same picked + leftover the save
                              floor and the arrangement board use). Set off by
                              a divider and the accent color so it reads as
                              the sum of the two before it, not a third
                              separate figure. */}
                          <span className="border-s border-border ps-4">
                            <Figure
                              caption="סה״כ"
                              value={lineTotal(variety.pallets, variety.leftover)}
                              emphasis
                            />
                          </span>
                        </span>
                      </div>
                      {variety.comment && (
                        <p className="break-words text-xs text-ink-muted">הערה: {variety.comment}</p>
                      )}
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
            {confirming ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// Rounded to two decimals because the columns are numeric(10,2) and a sum of
// two such values in floating point can come out as e.g. 0.30000000000000004.
// The editor only accepts whole numbers today, so this is a guard for older
// rows rather than something a new pick can trigger.
function lineTotal(pallets: number, leftover: number): number {
  return Math.round((pallets + leftover) * 100) / 100;
}

// One captioned number — the same נקטף / עודף captions the editor's own
// columns use, so each figure is labelled where it sits rather than by a
// column header the popup doesn't have. The space between the two spans is a
// real text node, so a screen reader (and the page's text) reads "נקטף 12",
// not "נקטף12".
function Figure({ caption, value, emphasis = false }: { caption: string; value: number; emphasis?: boolean }) {
  return (
    <span className="text-sm">
      <span className="text-xs text-ink-subtle">{caption}</span>{" "}
      <span className={`font-semibold tabular-nums ${emphasis ? "text-accent" : "text-ink"}`}>{value}</span>
    </span>
  );
}
