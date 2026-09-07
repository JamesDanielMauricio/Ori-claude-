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
// yet, matching the reference design's thumbnail.
function ProductThumbnail({ imageUrl }: { imageUrl?: string | null }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className="h-11 w-11 shrink-0 rounded-full border border-border object-cover"
      />
    );
  }
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-accent-soft text-accent">
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
      {families.map((family) => {
        const isOpen = expandedIds.has(family.familyId);
        return (
          <li key={family.familyId} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => toggle(family.familyId)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-canvas"
            >
              <ProductThumbnail imageUrl={family.imageUrl ?? null} />
              <Icon
                name="chevronDown"
                className={`h-4 w-4 shrink-0 text-ink-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{family.familyName}</span>
            </button>

            {isOpen && (
              <ul className="border-t border-border bg-surface-muted">
                {family.varieties.map((variety) => (
                  <li
                    key={variety.varietyId}
                    className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {variety.varietyName}
                        {variety.outOfStock && (
                          <span className="ms-2 text-xs text-danger">אזל מהמלאי</span>
                        )}
                      </p>
                      {variety.priceLabel && (
                        <p className="text-xs text-ink-muted">{variety.priceLabel}</p>
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
                        <p className="w-full text-xs text-ink-muted">הערה: {variety.comment}</p>
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
                        className={`${inputClassName} w-32 ps-7 pe-14`}
                        value={variety.pallets}
                        onChange={(event) => onChangePallets?.(variety.varietyId, event.target.value)}
                      />
                      <Icon
                        name="chevronDown"
                        className="pointer-events-none absolute inset-y-0 start-2 my-auto h-3.5 w-3.5 text-ink-subtle"
                      />
                      {variety.packType && (
                        <span className="pointer-events-none absolute inset-y-0 end-3 my-auto text-xs text-ink-subtle">
                          {PACK_TYPE_LABEL[variety.packType]}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
