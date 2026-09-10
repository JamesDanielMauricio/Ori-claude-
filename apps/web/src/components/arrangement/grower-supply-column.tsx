import { Icon } from "@/components/ui/icon";
import { ProductThumbnail } from "@/components/ui/product-thumbnail";

import {
  formatPallets,
  formatPickupTime,
  type GrowerFamilyGroup,
  type GrowerSupply,
  type PickSelection,
} from "./board-data";

// The reference design's right-hand column: the day's growers as a list of
// collection slots, each expanding to show what that grower actually picked.
//
// This column is also the screen's selector. Clicking one of a grower's
// variety rows is what sets "the product being arranged", and it has to be
// this list rather than a product picker of its own, because an arrangement
// record points at a specific `daily_pick_products` row — a variety alone
// doesn't identify one, and the same variety from two growers is two
// different lots with two different remaining balances.
//
// Collapsed by default and ordered by collection time, because the column's
// first job is the roll-call — who is coming, when, and is anything of
// theirs still unallocated.

export function GrowerSupplyColumn({
  growers,
  selection,
  expandedId,
  onToggle,
  onSelect,
  onEditPick,
  onToggleSubmit,
  toggleSubmitDisabled = false,
}: {
  growers: GrowerSupply[];
  selection: PickSelection | null;
  expandedId: string | null;
  onToggle: (growerId: string) => void;
  onSelect: (selection: PickSelection) => void;
  onEditPick: (grower: GrowerSupply) => void;
  // The truck icon: submits a draft pick, or reverts an already-submitted
  // one back to draft (a deliberate exception to the pick status state
  // machine's otherwise forward-only rule — see migration 0044). Not
  // offered at all once a pick is 'closed' — the trading day is done, and
  // there is nothing left to toggle.
  onToggleSubmit: (grower: GrowerSupply) => void;
  // True once the trading day itself is no longer open (closed, or the
  // sidebar's date picker has pinned a past day) — the whole column is
  // then a read-only history view, so the truck icon is disabled the same
  // way the pencil's edits are gated elsewhere on this screen.
  toggleSubmitDisabled?: boolean;
}) {
  return (
    <section className="animate-rise-in overflow-hidden rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted/60 px-5 py-3.5">
        <h2 className="font-display text-lg text-ink">מגדלים</h2>
        <span className="text-xs text-ink-muted">{growers.length}</span>
      </header>

      {growers.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-muted">אין היצע רשום עדיין.</p>
      ) : (
        <ul>
          {growers.map((grower, index) => (
            <GrowerRow
              key={grower.growerId}
              grower={grower}
              index={index}
              selection={selection}
              expanded={expandedId === grower.growerId}
              onToggle={() => onToggle(grower.growerId)}
              onSelect={onSelect}
              onEditPick={onEditPick}
              onToggleSubmit={onToggleSubmit}
              toggleSubmitDisabled={toggleSubmitDisabled}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function GrowerRow({
  grower,
  index,
  selection,
  expanded,
  onToggle,
  onSelect,
  onEditPick,
  onToggleSubmit,
  toggleSubmitDisabled,
}: {
  grower: GrowerSupply;
  index: number;
  selection: PickSelection | null;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (selection: PickSelection) => void;
  onEditPick: (grower: GrowerSupply) => void;
  onToggleSubmit: (grower: GrowerSupply) => void;
  toggleSubmitDisabled: boolean;
}) {
  const time = formatPickupTime(grower.pickupTime);
  const free = grower.picked - grower.allocated;
  const holdsSelection = selection?.growerId === grower.growerId;

  return (
    <li
      className="animate-stagger-in border-b border-border last:border-b-0"
      // Capped at 8 rows' worth of delay — see globals.css.
      style={{ "--stagger-index": Math.min(index, 8) } as React.CSSProperties}
    >
      <div
        className={`flex items-center gap-1 transition-colors duration-200 ${
          expanded ? "bg-accent-soft/40" : "hover:bg-surface-muted"
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="group flex min-w-0 flex-1 items-center gap-2.5 py-3 ps-4 text-start"
        >
          <Icon
            name="chevronDown"
            className={`h-4 w-4 shrink-0 transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
              expanded ? "rotate-180 text-accent" : "text-ink-muted group-hover:text-accent"
            }`}
          />
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate text-sm font-semibold ${
                // Tinted when this grower has the selected variety at all,
                // and marked below when it is *this* grower's line that is
                // actually selected.
                grower.hasSelected ? "text-accent" : "text-ink"
              }`}
            >
              {grower.growerName}
            </span>
            {/* Left in RTL flow: "51 נקטף" is a Hebrew phrase, and forcing
                it LTR put the numeral on the far side of the word it
                counts. */}
            <span className="mt-0.5 block text-[11px] text-ink-subtle">
              {formatPallets(grower.picked)} נקטף
              {free > 0 && ` · ${formatPallets(free)} פנוי`}
            </span>
          </span>
          {holdsSelection && (
            <span className="animate-pop-in shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-ink">
              נבחר
            </span>
          )}
          {time && (
            <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-muted" dir="ltr">
              {time}
            </span>
          )}
        </button>

        <div className="me-3 flex shrink-0 items-center gap-1.5">
          {/* The submit/un-submit toggle. Nothing to toggle once the pick is
              closed — the trading day is done, so the button disappears
              rather than sitting there disabled and unexplained. Coloured
              like the "נבחר" pill while submitted, so a glance down the
              column shows who's actually ready to be arranged against. */}
          {grower.status !== "closed" && (
            <button
              type="button"
              onClick={() => onToggleSubmit(grower)}
              disabled={toggleSubmitDisabled}
              aria-label={
                grower.status === "submitted"
                  ? `החזר את הליקוט של ${grower.growerName} לטיוטה`
                  : `שלח את הליקוט של ${grower.growerName} למפיץ`
              }
              title={grower.status === "submitted" ? "החזר לטיוטה" : "שלח ליקוט"}
              className={`flex h-10 w-10 items-center justify-center rounded-md ring-1 ring-inset transition-colors duration-200 disabled:pointer-events-none disabled:opacity-40 ${
                grower.status === "submitted"
                  ? "bg-accent-soft/60 text-accent ring-accent/40 hover:bg-accent-soft hover:ring-accent/60"
                  : "text-ink-subtle ring-border hover:bg-surface hover:text-accent hover:ring-accent/40"
              }`}
            >
              <Icon name="truck" className="h-4 w-4" />
            </button>
          )}

          {/* Opens the grower's pick in a popup, the same way the pencil on
              a customer card opens their order. Not a link to the "בשם
              מגדל" screen: the distributor is working one pick line down a
              list of customers, and navigating away to correct a pallet
              count would throw away the selection and everything built on
              top of it. */}
          <button
            type="button"
            onClick={() => onEditPick(grower)}
            aria-label={`ערוך את מלאי ${grower.growerName}`}
            title="ערוך מלאי מגדל"
            className="flex h-10 w-10 items-center justify-center rounded-md text-ink-subtle ring-1 ring-inset ring-border transition-colors duration-200 hover:bg-surface hover:text-accent hover:ring-accent/40"
          >
            <Icon name="pencil" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Height-animated rather than mounted/unmounted (globals.css
          `.accordion-panel`), and `inert` while closed so a collapsed
          grower's buttons stay out of the tab order. */}
      <div className="accordion-panel" data-open={expanded}>
        <div>
          <div className="border-t border-border bg-surface-muted/50 px-4 py-3" inert={!expanded}>
            {grower.families.map((family) => (
              <GrowerFamilyBlock
                key={family.familyId}
                family={family}
                growerId={grower.growerId}
                selection={selection}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

function GrowerFamilyBlock({
  family,
  growerId,
  selection,
  onSelect,
}: {
  family: GrowerFamilyGroup;
  growerId: string;
  selection: PickSelection | null;
  onSelect: (selection: PickSelection) => void;
}) {
  return (
    <div className="mb-3 overflow-hidden rounded-lg bg-surface shadow-card ring-1 ring-inset ring-border/70 last:mb-0">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <ProductThumbnail imageUrl={family.imageUrl} size="sm" />
        <p className="font-display truncate text-base text-ink">{family.familyName}</p>
      </div>

      <ul className="border-t border-border/70">
        {family.lines.map((line) => {
          const isSelected = selection?.pickLineId === line.pickLineId;
          return (
            <li key={line.pickLineId} className="border-b border-border/60 last:border-b-0">
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() =>
                  onSelect({
                    pickLineId: line.pickLineId,
                    varietyId: line.varietyId,
                    growerId,
                  })
                }
                className={`w-full px-3 py-2.5 text-start transition-colors duration-150 ${
                  // The selected row is banded and gets an edge bar rather
                  // than only a colour: the customer list opposite is read
                  // with this one in peripheral vision, so the match needs a
                  // shape.
                  isSelected
                    ? "bg-accent-soft/60 shadow-[inset_3px_0_0_var(--color-accent)]"
                    : "hover:bg-surface-muted/70"
                }`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span
                    className={`min-w-0 flex-1 truncate text-xs ${
                      isSelected ? "font-semibold text-accent" : "font-medium text-ink"
                    }`}
                  >
                    {line.varietyName}
                  </span>
                  {/* Allocated over picked, the way the reference pairs its
                      two boxes — "how much of what he brought is spoken for"
                      is one fact, not two. Committed-first so it reads as the
                      familiar "4 of 10", matching the identical fraction in
                      the customer card headers; a numeric fraction with no
                      Hebrew in it, so it stays LTR. */}
                  <span className="shrink-0 text-[11px] tabular-nums" dir="ltr">
                    <span className={line.allocated > 0 ? "text-accent" : "text-ink-subtle"}>
                      {formatPallets(line.allocated)}
                    </span>
                    <span className="text-ink-subtle"> / </span>
                    <span className="font-semibold text-ink">{formatPallets(line.picked)}</span>
                  </span>
                </span>
                {line.comment && (
                  <span
                    className="mt-1 block truncate text-[11px] italic text-ink-muted"
                    title={line.comment}
                  >
                    {line.comment}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
