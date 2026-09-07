import { useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export interface OrderVarietyRow {
  varietyId: string;
  varietyName: string;
  priceLabel: string | null;
  packType: "pallets" | "crates" | null;
  pallets: string;
  comment: string;
  outOfStock?: boolean;
}

const PACK_TYPE_LABEL: Record<"pallets" | "crates", string> = {
  pallets: "משטחים",
  crates: "ארגזים",
};

export interface OrderFamilyRow {
  familyId: string;
  familyName: string;
  // product_families.image_url (migration 0036, applied 2026-09-08) — null
  // until a real photo is set per family; ProductThumbnail falls back to a
  // generic icon either way.
  imageUrl?: string | null;
  varieties: OrderVarietyRow[];
}

// Round photo, or a generic produce icon while a family has no photo set
// yet, matching the reference design's thumbnail. The ring sits *inside* the
// element (`ring-inset`) so a photo's own edge isn't clipped by a border
// drawn on top of it.
function ProductThumbnail({ imageUrl }: { imageUrl?: string | null }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        // `loading="lazy"` because a long catalog would otherwise fetch every
        // family's photo before the first row is interactive.
        loading="lazy"
        className="h-11 w-11 shrink-0 rounded-full object-cover shadow-card ring-1 ring-inset ring-border transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] group-hover:scale-105"
      />
    );
  }
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-soft to-accent-soft/50 text-accent ring-1 ring-inset ring-accent/15 transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] group-hover:scale-105">
      <Icon name="leaf" className="h-5 w-5" />
    </span>
  );
}

// The reference design's shop screen: a collapsed row per product FAMILY
// (photo + name + chevron), expanding to that family's individual
// varieties — each with its own price/quantity/comment. One shared
// presentation for both the live order screen (editable) and the
// read-only historical order view (past, closed trading days);
// `onChangePallets`/`onOpenComment` are omitted in the read-only case.
export function OrderProductList({
  families,
  editable,
  onChangePallets,
  onOpenComment,
}: {
  families: OrderFamilyRow[];
  editable: boolean;
  onChangePallets?: (varietyId: string, value: string) => void;
  onOpenComment?: (varietyId: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggle(familyId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(familyId)) {
        next.delete(familyId);
      } else {
        next.add(familyId);
      }
      return next;
    });
  }

  return (
    <ul>
      {families.map((family, familyIndex) => {
        const isOpen = expandedIds.has(family.familyId);
        // How many varieties in this family already carry a quantity. Shown
        // as a chip on the collapsed row so a user scrolling a long catalog
        // can see what they've already filled in without opening every
        // family to check — previously the only way to find your own entries
        // was to expand each one in turn.
        const filledCount = family.varieties.filter(
          (variety) => Number(variety.pallets) > 0,
        ).length;

        return (
          <li
            key={family.familyId}
            className="animate-stagger-in border-b border-border last:border-b-0"
            // Capped at 8 so a long catalog's last rows don't arrive after
            // the user has already started scrolling (see globals.css).
            style={{ "--stagger-index": Math.min(familyIndex, 8) } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={() => toggle(family.familyId)}
              aria-expanded={isOpen}
              className={`group flex w-full items-center gap-3 px-4 py-3 text-start transition-colors duration-200 ${
                isOpen ? "bg-accent-soft/40" : "hover:bg-surface-muted"
              }`}
            >
              <ProductThumbnail imageUrl={family.imageUrl ?? null} />
              <Icon
                name="chevronDown"
                className={`h-4 w-4 shrink-0 transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
                  isOpen ? "rotate-180 text-accent" : "text-ink-muted group-hover:text-accent"
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {family.familyName}
              </span>

              {filledCount > 0 && (
                <span className="animate-pop-in shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">
                  {filledCount}
                </span>
              )}
            </button>

            {/* Always rendered, height-animated by the CSS grid technique in
                globals.css (`.accordion-panel`) rather than mounted and
                unmounted. Two reasons: a collapse can animate closed at all
                only if the content still exists on the way out, and keeping
                the inputs mounted preserves anything typed into a family the
                user collapses and reopens before saving.
                `inert` keeps the hidden subtree out of the tab order and off
                the accessibility tree while it's closed — without it, tabbing
                past a collapsed family walks through invisible inputs. */}
            <div className="accordion-panel" data-open={isOpen}>
              <div>
                <ul className="border-t border-border bg-surface-muted/60" inert={!isOpen}>
                  {family.varieties.map((variety) => (
                    <li
                      key={variety.varietyId}
                      className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3 transition-colors duration-150 last:border-b-0 hover:bg-surface"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {variety.varietyName}
                          {variety.outOfStock && (
                            <span className="ms-2 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">
                              אזל מהמלאי
                            </span>
                          )}
                        </p>
                        {variety.priceLabel && (
                          <p className="mt-0.5 text-xs font-medium text-ink-muted">
                            {variety.priceLabel}
                          </p>
                        )}
                      </div>
                      {editable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenComment?.(variety.varietyId)}
                        >
                          {variety.comment ? "✎ הערה" : "+ הערה"}
                        </Button>
                      ) : (
                        variety.comment && (
                          <p className="w-full rounded-md bg-surface px-2.5 py-1.5 text-xs text-ink-muted ring-1 ring-inset ring-border">
                            הערה: {variety.comment}
                          </p>
                        )
                      )}
                      {/* Quantity + pack type together, matching the reference
                          design's single pill-shaped control — pack_type is
                          fixed per product (set by backoffice, never chosen
                          per order line), so the chevron is decorative, not a
                          working dropdown. */}
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={!editable}
                          aria-label={`כמות ${variety.packType ? PACK_TYPE_LABEL[variety.packType] : "פלטות"} — ${variety.varietyName}`}
                          className={`${inputClassName} w-32 ps-7 pe-14 font-semibold`}
                          value={variety.pallets}
                          onChange={(event) =>
                            onChangePallets?.(variety.varietyId, event.target.value)
                          }
                        />
                        <Icon
                          name="chevronDown"
                          className="pointer-events-none absolute inset-y-0 start-2 my-auto h-3.5 w-3.5 text-ink-subtle"
                        />
                        {variety.packType && (
                          <span className="pointer-events-none absolute inset-y-0 end-3 my-auto flex items-center text-xs font-medium text-ink-subtle">
                            {PACK_TYPE_LABEL[variety.packType]}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
