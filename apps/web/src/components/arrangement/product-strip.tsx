import { StatusPill } from "@/components/ui/card";
import { ProductThumbnail } from "@/components/ui/product-thumbnail";

import { formatPallets, type BoardProduct, type SelectedPickLine } from "./board-data";

// The reference design's top band: the product currently being worked on,
// and the four numbers that decide what to do about it.
//
// Those four are the whole point of the screen — picked, ordered, allocated,
// still free — and in the old layout none of them existed. Supply and demand
// were two separate lists you had to read against each other, and "how much
// of this have I already committed" was only recoverable by scrolling to the
// records table and adding rows up by eye.
//
// This is a readout, not a picker. Selection happens by clicking a variety
// inside a grower's card in the column below, because an allocation is
// always *from a particular grower's pick line* — a product on its own is
// not enough to write one. An earlier revision had a chip rail here that
// selected a bare variety; on the seeded catalogue that was 607 chips, and
// it could not answer "from whom" anyway.

const STATS: Array<{
  key: "picked" | "ordered" | "allocated" | "remaining";
  label: string;
  hint: string;
}> = [
  { key: "picked", label: "נקטף", hint: "סך המשטחים שהמגדלים קטפו" },
  { key: "ordered", label: "הוזמן", hint: "סך המשטחים שהלקוחות הזמינו" },
  { key: "allocated", label: "חולק", hint: "משטחים שכבר שויכו ברשומות סידור" },
  { key: "remaining", label: "נותר", hint: "נקטף פחות חולק — מה שעוד פנוי לסידור" },
];

export function ProductStrip({
  product,
  selected,
  onEditPrice,
}: {
  product: BoardProduct | null;
  selected: SelectedPickLine | null;
  onEditPrice: (varietyId: string) => void;
}) {
  return (
    <section className="animate-rise-in overflow-hidden rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5 px-5 py-4">
        {product ? (
          <div className="group flex min-w-0 items-center gap-3.5">
            <ProductThumbnail imageUrl={product.imageUrl} />
            <div className="min-w-0">
              {/* Family above, variety below. The reference sets the family
                  as the headline and the variety as a smaller line under it,
                  which is the right way round: "רימון" is what the
                  distributor is thinking about, "4 וונדרפול" is which one. */}
              <p className="truncate text-sm font-semibold leading-tight text-ink">
                {product.familyName || product.varietyName}
              </p>
              <p className="mt-0.5 truncate text-xs font-semibold text-ink-muted">
                {product.varietyName}
              </p>
            </div>
            {product.outOfStock && <StatusPill tone="danger">חוסר במלאי</StatusPill>}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">בחר מוצר מכרטיס של מגדל כדי לסדר אותו ללקוחות.</p>
        )}

        <div className="flex flex-wrap items-start gap-x-7 gap-y-4">
          {STATS.map((stat) => {
            const value = product ? product[stat.key] : null;
            // Only "נותר" carries a colour, and only when it has gone
            // negative — which means more has been arranged off this variety
            // than was ever picked. Tinting all four would make the row a
            // decoration; tinting the one that can be wrong makes it an
            // alarm.
            const negative = value !== null && stat.key === "remaining" && value < 0;
            return (
              // Grouped and named, so the label and the numeral are announced
              // as one thing. As two bare paragraphs a screen reader read
              // "נקטף" and "80" as unrelated text, which is exactly as useful
              // as reading a table with its headers stripped off.
              <div
                key={stat.key}
                role="group"
                aria-label={stat.label}
                className="min-w-[4.5rem]"
                title={stat.hint}
              >
                <p
                  aria-hidden
                  className="text-xs font-semibold tracking-[0.08em] text-ink-subtle"
                >
                  {stat.label}
                </p>
                <p
                  className={`font-display mt-1 text-2xl leading-none ${
                    negative ? "text-danger" : "text-ink"
                  }`}
                  dir="ltr"
                >
                  {value === null ? "—" : formatPallets(value)}
                </p>
              </div>
            );
          })}

          {product && (
            <button
              type="button"
              onClick={() => onEditPrice(product.varietyId)}
              className="mt-4 flex h-9 shrink-0 items-center rounded-md px-3 text-xs font-semibold text-ink-muted ring-1 ring-inset ring-border-strong transition-colors duration-200 hover:bg-accent-soft/70 hover:text-accent"
            >
              ערוך מחיר
            </button>
          )}
        </div>
      </div>

      {/* Which grower's pallets are being handed out, and how many of them
          are left. Every ✓ on the customer list below writes against this one
          pick line, so naming it here is not context — it is the subject of
          every action on the screen, and leaving it implicit is how produce
          ends up allocated off the wrong grower. */}
      {selected && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border bg-accent-soft/40 px-5 py-2.5">
          <p className="text-xs text-ink-muted">
            מסדר מ־<span className="font-semibold text-accent">{selected.grower.growerName}</span>
          </p>
          <p className="text-xs text-ink-muted">
            נקטף{" "}
            <span className="font-semibold text-ink">{formatPallets(selected.line.picked)}</span>
            {" · "}
            חולק{" "}
            <span className="font-semibold text-ink">{formatPallets(selected.line.allocated)}</span>
            {" · "}
            פנוי{" "}
            <span
              className={`font-semibold ${selected.line.remaining > 0 ? "text-accent" : "text-danger"}`}
            >
              {formatPallets(selected.line.remaining)}
            </span>
          </p>
          {selected.line.comment && (
            <p className="truncate text-xs italic text-ink-muted">{selected.line.comment}</p>
          )}
        </div>
      )}
    </section>
  );
}
