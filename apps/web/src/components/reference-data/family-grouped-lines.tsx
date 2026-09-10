import { ProductThumbnail } from "@/components/ui/product-thumbnail";

// A read-only, family-grouped list of a single pick's or a single order's
// lines — what a row's expand chevron reveals on the "בשם מגדל" / "בשם לקוח"
// oversight screens. Presentational only: each route normalizes its own
// query rows (daily_pick_products or daily_order_products, embedded with
// product_varieties → product_families) into the generic shape below, so
// this one component and its grouping-by-family visual is not duplicated
// between the grower and customer screens even though their underlying
// tables differ (a pick line carries a pickup time, an order line doesn't).
//
// Same family-block layout as the arrangement board's GrowerFamilyBlock
// (components/arrangement/grower-supply-column.tsx) — a round photo, the
// family name, a hairline-divided list of varieties — but without that
// component's selection state: nothing here is clickable, because this is
// the READ view. Editing is the pencil beside the row, which opens the same
// PickLinesEditor/OrderLinesEditor this data was drawn from, in full.
export interface FamilyGroupedLine {
  id: string;
  varietyName: string;
  /** Already formatted (formatPallets), so this component stays unit-agnostic. */
  quantityLabel: string;
  hasQuantity: boolean;
  /** Pickup time on a pick line; omitted on an order line. */
  secondary?: string | null;
  comment?: string | null;
}

export interface FamilyGroupedRow {
  familyId: string;
  familyName: string;
  imageUrl: string | null;
  lines: FamilyGroupedLine[];
}

export function FamilyGroupedLines({
  families,
  emptyLabel,
}: {
  families: FamilyGroupedRow[];
  /** Shown when the pick/order exists but has no lines at all yet. */
  emptyLabel: string;
}) {
  if (families.length === 0) {
    return <p className="px-4 py-3 text-xs text-ink-muted">{emptyLabel}</p>;
  }

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {families.map((family) => (
        <FamilyBlock key={family.familyId} family={family} />
      ))}
    </div>
  );
}

function FamilyBlock({ family }: { family: FamilyGroupedRow }) {
  return (
    <div className="overflow-hidden rounded-lg bg-surface shadow-card ring-1 ring-inset ring-border/70">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <ProductThumbnail imageUrl={family.imageUrl} size="sm" />
        <p className="font-display truncate text-base text-ink">{family.familyName}</p>
      </div>

      <ul className="border-t border-border/70">
        {family.lines.map((line) => (
          <li key={line.id} className="border-b border-border/60 px-3 py-2 last:border-b-0">
            <span className="flex items-baseline justify-between gap-3">
              <span
                className={`min-w-0 flex-1 truncate text-xs ${
                  line.hasQuantity ? "font-medium text-ink" : "text-ink-subtle"
                }`}
              >
                {line.varietyName}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                {line.secondary && (
                  <span className="text-[11px] tabular-nums text-ink-subtle" dir="ltr">
                    {line.secondary}
                  </span>
                )}
                <span
                  className={`text-[11px] font-semibold tabular-nums ${
                    line.hasQuantity ? "text-accent" : "text-ink-subtle"
                  }`}
                  dir="ltr"
                >
                  {line.quantityLabel}
                </span>
              </span>
            </span>
            {line.comment && (
              <span
                className="mt-0.5 block truncate text-[11px] italic text-ink-muted"
                title={line.comment}
              >
                {line.comment}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
