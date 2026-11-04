import type { UseQueryResult } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";

import { CellChipList, CellPopover } from "@/components/reference-data/cell-popover";
import { checkboxClassName, inputClassName } from "@/components/reference-data/form-field";
import type { RecordTableColumn } from "@/components/reference-data/record-table";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { blockWheel } from "@/lib/integer-input";
import type { PalletCap, ProductFamily, ProductVariety } from "@/lib/queries/reference-data";

import {
  CREATED_AT_FORMAT,
  NAME_GUTTER_PAD,
  PACK_TYPE_LABEL,
  orDash,
  type FormState,
  type PackType,
} from "./catalog-form";

export interface VarietyColumnsContext {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  familyById: ReadonlyMap<string, ProductFamily>;
  familiesQuery: UseQueryResult<ProductFamily[]>;
  customersQuery: UseQueryResult<Array<{ id: string; name: string }>>;
  capsQuery: UseQueryResult<Map<string, PalletCap[]>>;
  customerNameById: ReadonlyMap<string, string>;
  openFamily: (familyId: string) => void;
  addCap: () => void;
  updateCap: (index: number, patch: Partial<PalletCap>) => void;
  removeCap: (index: number) => void;
}

// The two family-level fields the flat table used to repeat on every
// variety row — the photo and the category — are gone from the columns
// below. They now appear once, on their family's own header row, where
// they are also editable; keeping a read-only copy per variety would show
// the same value in two places and let only one of them be changed.
export function buildVarietyColumns({
  form,
  setForm,
  familyById,
  familiesQuery,
  customersQuery,
  capsQuery,
  customerNameById,
  openFamily,
  addCap,
  updateCap,
  removeCap,
}: VarietyColumnsContext): RecordTableColumn<ProductVariety>[] {
  return [
    {
      key: "name",
      label: "זן",
      groupLabel: "משפחה",
      // Every family's expand toggle and "זן חדש" button live in this
      // column, so hiding it would strand the whole catalog closed.
      alwaysVisible: true,
      render: (row) => (
        <span className={`block font-medium text-ink ${NAME_GUTTER_PAD}`}>{row.name}</span>
      ),
      renderEdit: () => (
        // Padded to the same gutter as the read state, so the field opens
        // exactly where the name it replaces was sitting rather than jumping
        // to the cell edge the moment the row goes into edit mode.
        <div className={NAME_GUTTER_PAD}>
          <input
            aria-label="זן / שם"
            autoFocus
            required
            className={`${inputClassName} w-full min-w-[9rem]`}
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </div>
      ),
    },
    {
      key: "family",
      label: "משפחה",
      groupLabel: "קטגוריה",
      // Redundant with the header row this variety already sits under while
      // it's only being read — but it stays, because MOVING a variety to a
      // different family is a real edit and this dropdown is the only place
      // it can be made. Changing it moves the row under the family it names
      // straight away (see `getGroupId` below — an editing row is grouped by
      // the family it is about to be SAVED to, not the one it came from),
      // which is why the target family is opened here too: otherwise the row
      // would drop into a collapsed group and vanish mid-edit.
      // Drawn in the muted ink rather than the body ink: in a grouped table
      // every row of a section repeats that section's own name, which makes
      // this the most-repeated text on the screen and, at full strength, the
      // thing the eye keeps landing on instead of the fields that actually
      // differ from row to row. It stays visible — a row can be searched into
      // view away from its family, and an orphan row has no header above it
      // at all — just quieter.
      render: (row) => (
        <span className="text-ink-muted">{orDash(familyById.get(row.family_id)?.name)}</span>
      ),
      renderEdit: () => (
        <Select
          aria-label="משפחה"
          className="w-full min-w-[8rem]"
          value={form.familyId}
          onChange={(next) => {
            openFamily(next);
            setForm((current) => ({ ...current, familyId: next }));
          }}
          options={
            familiesQuery.data?.map((family) => ({ value: family.id, label: family.name })) ?? []
          }
        />
      ),
    },
    {
      key: "sizes",
      label: "גודל",
      groupLabel: "מספר זנים",
      render: (row) => orDash(row.sizes),
      renderEdit: () => (
        <input
          aria-label="גדלים"
          className={`${inputClassName} w-28`}
          value={form.sizes}
          onChange={(event) => setForm((current) => ({ ...current, sizes: event.target.value }))}
        />
      ),
    },
    {
      key: "packType",
      label: "סוג אריזה",
      render: (row) => orDash(row.pack_type ? PACK_TYPE_LABEL[row.pack_type] : null),
      renderEdit: () => (
        <Select
          aria-label="סוג אריזה"
          className="w-28"
          value={form.packType}
          onChange={(next) =>
            setForm((current) => ({ ...current, packType: next as PackType | "" }))
          }
          options={[
            { value: "", label: "—" },
            { value: "pallets", label: "משטחים" },
            { value: "crates", label: "ארגזים" },
          ]}
        />
      ),
    },
    {
      key: "price",
      label: "מחיר",
      render: (row) => orDash(row.price),
      renderEdit: () => (
        <input
          type="number"
          step="0.01"
          aria-label="מחיר"
          className={`${inputClassName} w-24`}
          value={form.price}
          onWheel={blockWheel}
          onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
        />
      ),
    },
    {
      key: "priceFrom",
      label: "טווח מ-",
      render: (row) => orDash(row.price_range_from),
      renderEdit: () => (
        <input
          type="number"
          step="0.01"
          aria-label="טווח מ-"
          className={`${inputClassName} w-24`}
          value={form.priceRangeFrom}
          onWheel={blockWheel}
          onChange={(event) =>
            setForm((current) => ({ ...current, priceRangeFrom: event.target.value }))
          }
        />
      ),
    },
    {
      key: "priceTo",
      label: "טווח עד",
      render: (row) => orDash(row.price_range_to),
      renderEdit: () => (
        <input
          type="number"
          step="0.01"
          aria-label="טווח עד"
          className={`${inputClassName} w-24`}
          value={form.priceRangeTo}
          onWheel={blockWheel}
          onChange={(event) =>
            setForm((current) => ({ ...current, priceRangeTo: event.target.value }))
          }
        />
      ),
    },
    {
      key: "priceType",
      label: "סוג מחיר",
      render: (row) => orDash(row.price_type),
      renderEdit: () => (
        <input
          aria-label="סוג תמחור"
          className={`${inputClassName} w-28`}
          value={form.priceType}
          onChange={(event) =>
            setForm((current) => ({ ...current, priceType: event.target.value }))
          }
        />
      ),
    },
    {
      key: "overbooking",
      label: "הזמנת יתר",
      render: (row) => row.no_overbooking,
      renderEdit: () => (
        <input
          type="number"
          step="1"
          min={0}
          aria-label="חריגת הזמנה מותרת (No Overbooking)"
          className={`${inputClassName} w-24`}
          value={form.noOverbooking}
          onWheel={blockWheel}
          onChange={(event) =>
            setForm((current) => ({ ...current, noOverbooking: event.target.value }))
          }
        />
      ),
    },
    {
      key: "orderCap",
      label: "מקס' הזמנות ללקוח",
      // The customer order screen's dropdown (order-product-list.tsx) reads
      // this as its own ceiling — never applied to a backoffice
      // on-behalf-of edit, where staff may deliberately exceed it. Empty
      // means uncapped. See product-variety.ts's schema comment for how it
      // differs from the per-customer caps column (one default for every
      // customer vs. an override for one).
      render: (row) => orDash(row.number_of_orders_per_customer),
      renderEdit: () => (
        <input
          type="number"
          step="1"
          // 1, not 0: saveProductInputSchema requires a positive cap, and
          // "no cap" is the empty box, not zero.
          min={1}
          placeholder="ללא הגבלה"
          aria-label="כמות מקסימלית להזמנה ללקוח (Number of Orders per Customer)"
          className={`${inputClassName} w-28`}
          value={form.numberOfOrdersPerCustomer}
          onWheel={blockWheel}
          onChange={(event) =>
            setForm((current) => ({ ...current, numberOfOrdersPerCustomer: event.target.value }))
          }
        />
      ),
    },
    {
      key: "caps",
      label: "תקרות ללקוח",
      render: (row) => (
        <CellChipList
          items={(capsQuery.data?.get(row.id) ?? []).map(
            (cap) =>
              `${customerNameById.get(cap.customerCompanyId) ?? cap.customerCompanyId}: ${cap.palletCap}`,
          )}
          emptyLabel="אין תקרות"
        />
      ),
      renderEdit: () => (
        <CellPopover
          label="תקרות משטחים ללקוח"
          summary={`${form.customerPalletCaps.length} תקרות`}
          panelClassName="w-[26rem]"
        >
          <div className="flex flex-col gap-2">
            {form.customerPalletCaps.map((cap, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Select
                  aria-label="לקוח"
                  className="min-w-0 flex-1"
                  value={cap.customerCompanyId}
                  onChange={(next) => updateCap(index, { customerCompanyId: next })}
                  options={
                    customersQuery.data?.map((customer) => ({
                      value: customer.id,
                      label: customer.name,
                    })) ?? []
                  }
                />
                <input
                  type="number"
                  min={0}
                  aria-label="תקרת משטחים"
                  className={`${inputClassName} w-20`}
                  value={cap.palletCap}
                  onWheel={blockWheel}
                  onChange={(event) => updateCap(index, { palletCap: Number(event.target.value) })}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => removeCap(index)}>
                  הסר
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addCap}
              disabled={!customersQuery.data?.length}
            >
              הוסף תקרה
            </Button>
          </div>
        </CellPopover>
      ),
    },
    {
      key: "seasonal",
      label: "בעונה",
      render: (row) => (
        <StatusPill tone={row.is_seasonal_available ? "accent" : "neutral"} dot>
          {row.is_seasonal_available ? "בעונה" : "לא בעונה"}
        </StatusPill>
      ),
      renderEdit: () => (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className={checkboxClassName}
            aria-label="זמין בעונה הנוכחית"
            checked={form.isSeasonalAvailable}
            onChange={(event) =>
              setForm((current) => ({ ...current, isSeasonalAvailable: event.target.checked }))
            }
          />
          {form.isSeasonalAvailable ? "בעונה" : "לא בעונה"}
        </label>
      ),
    },
    {
      key: "highlight",
      label: "הבלטת תנודות מחיר",
      render: (row) => (row.highlight_price_fluctuations ? "כן" : "לא"),
      renderEdit: () => (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className={checkboxClassName}
            aria-label="הדגש תנודות מחיר"
            checked={form.highlightPriceFluctuations}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                highlightPriceFluctuations: event.target.checked,
              }))
            }
          />
          {form.highlightPriceFluctuations ? "כן" : "לא"}
        </label>
      ),
    },
    {
      key: "created",
      label: "נוצר",
      render: (row) =>
        orDash(row.created_at ? CREATED_AT_FORMAT.format(new Date(row.created_at)) : null),
    },
  ];
}
