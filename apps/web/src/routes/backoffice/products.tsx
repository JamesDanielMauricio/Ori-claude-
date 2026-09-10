import {
  PRODUCT_VERSION_CONFLICT_ERROR_CODE,
  saveProductInputSchema,
  toSaveProductRpcArgs,
} from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { ActionBar } from "@/components/reference-data/action-bar";
import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { ListDetailLayout } from "@/components/reference-data/list-detail-layout";
import { RecordList } from "@/components/reference-data/record-list";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormSection, StatusPill } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { hasChanges } from "@/lib/has-changes";
import { createClient } from "@/lib/supabase/client";

type PackType = "pallets" | "crates";

interface ProductVariety {
  id: string;
  family_id: string;
  name: string;
  sizes: string | null;
  pack_type: PackType | null;
  price: string | null;
  price_range_from: string | null;
  price_range_to: string | null;
  price_type: string | null;
  no_overbooking: string;
  highlight_price_fluctuations: boolean;
  is_seasonal_available: boolean;
  number_of_orders_per_customer: number | null;
  version: number;
}

interface PalletCap {
  customerCompanyId: string;
  palletCap: number;
}

interface FormState {
  familyId: string;
  name: string;
  sizes: string;
  packType: PackType | "";
  price: string;
  priceRangeFrom: string;
  priceRangeTo: string;
  priceType: string;
  noOverbooking: string;
  highlightPriceFluctuations: boolean;
  isSeasonalAvailable: boolean;
  // Empty string = no variety-level cap (see product-variety.ts's schema
  // comment). Kept as a string here for the same reason every other numeric
  // form field is: an <input> can't hold `null`.
  numberOfOrdersPerCustomer: string;
  version: number | null;
  customerPalletCaps: PalletCap[];
}

function blankForm(defaultFamilyId: string): FormState {
  return {
    familyId: defaultFamilyId,
    name: "",
    sizes: "",
    packType: "",
    price: "",
    priceRangeFrom: "",
    priceRangeTo: "",
    priceType: "",
    noOverbooking: "0",
    highlightPriceFluctuations: false,
    isSeasonalAvailable: true,
    numberOfOrdersPerCustomer: "",
    version: null,
    customerPalletCaps: [],
  };
}

function toFormState(row: ProductVariety, caps: PalletCap[]): FormState {
  return {
    familyId: row.family_id,
    name: row.name,
    sizes: row.sizes ?? "",
    packType: row.pack_type ?? "",
    price: row.price ?? "",
    priceRangeFrom: row.price_range_from ?? "",
    priceRangeTo: row.price_range_to ?? "",
    priceType: row.price_type ?? "",
    noOverbooking: row.no_overbooking,
    highlightPriceFluctuations: row.highlight_price_fluctuations,
    isSeasonalAvailable: row.is_seasonal_available,
    numberOfOrdersPerCustomer:
      row.number_of_orders_per_customer == null ? "" : String(row.number_of_orders_per_customer),
    version: row.version,
    customerPalletCaps: caps,
  };
}

// The Products management screen — catalog (family + variety), pricing,
// overbooking, and the new per-customer pallet cap control. `save_product`
// is where the conflict-prevention rule actually lives (R7): every save
// carries the version this form last loaded, and a rejection means someone
// else saved first — surfaced here as a clear message and a forced reload,
// never a silent overwrite and never a UI "someone's editing this" lock.
export default function ProductsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm(""));
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const familiesQuery = useQuery({
    queryKey: ["reference-data", "product-families"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_families")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string }>;
    },
  });

  const productsQuery = useQuery({
    queryKey: ["reference-data", "products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_varieties")
        .select(
          "id, family_id, name, sizes, pack_type, price, price_range_from, price_range_to, price_type, no_overbooking, highlight_price_fluctuations, is_seasonal_available, number_of_orders_per_customer, version, product_families(name)",
        )
        .order("name");
      if (error) throw error;
      return data as Array<ProductVariety & { product_families: { name: string } | null }>;
    },
  });

  const customersQuery = useQuery({
    queryKey: ["reference-data", "customers-for-caps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name")
        .eq("type", "customer")
        .order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string }>;
    },
  });

  const capsQuery = useQuery({
    queryKey: ["reference-data", "product-customer-caps", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_customer_caps")
        .select("customer_company_id, pallet_cap")
        .eq("product_variety_id", selectedId!);
      if (error) throw error;
      return data.map((row) => ({
        customerCompanyId: row.customer_company_id,
        palletCap: row.pallet_cap,
      }));
    },
  });

  const selected = productsQuery.data?.find((row) => row.id === selectedId) ?? null;

  // The variety is the row's identity; its family is context, so it goes on
  // the second line instead of being joined to the front with an em dash.
  // That also means the family name no longer eats the width every row needs
  // for the variety itself.
  const listItems = useMemo(
    () =>
      (productsQuery.data ?? []).map((row) => ({
        id: row.id,
        label: row.name,
        meta: row.product_families?.name ?? null,
        badge: row.is_seasonal_available ? null : "לא בעונה",
      })),
    [productsQuery.data],
  );

  useEffect(() => {
    if (!editing && selected && capsQuery.data) {
      setForm(toFormState(selected, capsQuery.data));
    }
  }, [selected, capsQuery.data, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = saveProductInputSchema.parse({
        id: selectedId,
        familyId: form.familyId,
        name: form.name,
        sizes: form.sizes || null,
        packType: form.packType || null,
        price: form.price === "" ? null : Number(form.price),
        priceRangeFrom: form.priceRangeFrom === "" ? null : Number(form.priceRangeFrom),
        priceRangeTo: form.priceRangeTo === "" ? null : Number(form.priceRangeTo),
        priceType: form.priceType || null,
        noOverbooking: Number(form.noOverbooking || "0"),
        highlightPriceFluctuations: form.highlightPriceFluctuations,
        isSeasonalAvailable: form.isSeasonalAvailable,
        numberOfOrdersPerCustomer:
          form.numberOfOrdersPerCustomer === "" ? null : Number(form.numberOfOrdersPerCustomer),
        expectedVersion: form.version,
        customerPalletCaps: form.customerPalletCaps,
      });
      const { data, error } = await supabase.rpc("save_product", toSaveProductRpcArgs(input));
      if (error) throw error;
      return data as ProductVariety;
    },
    onSuccess: (row) => {
      showToast("הנתונים נשמרו.", "success");
      setEditing(false);
      setSelectedId(row.id);
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "products"] });
      void queryClient.invalidateQueries({
        queryKey: ["reference-data", "product-customer-caps", row.id],
      });
    },
    onError: (error: { message?: string; code?: string }) => {
      if (error.code === PRODUCT_VERSION_CONFLICT_ERROR_CODE) {
        showToast(
          "המוצר עודכן על ידי משתמש אחר בינתיים. הנתונים רועננו — בדוק ושמור שוב.",
          "error",
        );
        void queryClient.invalidateQueries({ queryKey: ["reference-data", "products"] });
        void queryClient.invalidateQueries({
          queryKey: ["reference-data", "product-customer-caps", selectedId],
        });
        setEditing(false);
      } else {
        showToast(`השמירה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) return;
      const { error } = await supabase.from("product_varieties").delete().eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("המוצר נמחק.", "success");
      setSelectedId(null);
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "products"] });
    },
    onError: (error: { message?: string }) => {
      showToast(`המחיקה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
      setDeleteOpen(false);
    },
  });

  function handleSelect(id: string) {
    setSelectedId(id);
    setEditing(false);
  }

  function handleNew() {
    setSelectedId(null);
    setForm(blankForm(familiesQuery.data?.[0]?.id ?? ""));
    setEditing(true);
  }

  // The values with no unsaved edits — both what "בטל שינויים" restores and
  // what the live form is compared against. See customers.tsx for why these
  // are one expression rather than two.
  //
  // `version` rides along inside FormState but can never differ between the
  // two sides: nothing in this form edits it, and a save that bumps it also
  // re-seeds the form from the returned row. It is the optimistic-locking
  // token (R7), not a field, so it neither can nor should make the form read
  // as changed.
  const baselineForm =
    selected && capsQuery.data
      ? toFormState(selected, capsQuery.data)
      : blankForm(familiesQuery.data?.[0]?.id ?? "");
  const dirty = hasChanges(form, baselineForm);

  function handleDiscard() {
    setForm(baselineForm);
    setEditing(false);
  }

  function handleSave() {
    setSaving(true);
    saveMutation.mutate(undefined, { onSettled: () => setSaving(false) });
  }

  function addCap() {
    const firstCustomer = customersQuery.data?.[0];
    if (!firstCustomer) return;
    setForm((current) => ({
      ...current,
      customerPalletCaps: [
        ...current.customerPalletCaps,
        { customerCompanyId: firstCustomer.id, palletCap: 0 },
      ],
    }));
  }

  function updateCap(index: number, patch: Partial<PalletCap>) {
    setForm((current) => ({
      ...current,
      customerPalletCaps: current.customerPalletCaps.map((cap, i) =>
        i === index ? { ...cap, ...patch } : cap,
      ),
    }));
  }

  function removeCap(index: number) {
    setForm((current) => ({
      ...current,
      customerPalletCaps: current.customerPalletCaps.filter((_, i) => i !== index),
    }));
  }

  return (
    <>
      <ListDetailLayout
        header={
          <PageHeader
            title="מוצרים"
            subtitle="קטלוג הזנים: מחירים, אוברבוקינג, עונתיות ומגבלות ללקוח."
          />
        }
        list={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <Button type="button" onClick={handleNew} disabled={!familiesQuery.data?.length}>
              מוצר חדש
            </Button>
            <RecordList
              icon="package"
              items={listItems}
              selectedId={selectedId}
              onSelect={handleSelect}
              loading={productsQuery.isLoading}
              searchPlaceholder="חיפוש מוצר או זן"
              emptyLabel="אין מוצרים עדיין."
            />
          </div>
        }
        detail={
          selectedId === null && !editing ? (
            <EmptyState
              icon="package"
              title="לא נבחר מוצר"
              hint="בחר זן מהרשימה כדי לערוך מחירים, אוברבוקינג ועונתיות, או צור מוצר חדש."
              action={
                <Button type="button" onClick={handleNew} disabled={!familiesQuery.data?.length}>
                  מוצר חדש
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-3.5 border-b border-border pb-5">
                <span
                  aria-hidden
                  className="font-display flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl text-accent ring-1 ring-inset ring-accent/25"
                >
                  {form.name.trim().charAt(0) || "+"}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-display truncate text-xl text-ink">
                    {form.name || "מוצר חדש"}
                  </h2>
                  <p className="mt-0.5 truncate text-sm text-ink-muted">
                    {familiesQuery.data?.find((family) => family.id === form.familyId)?.name ?? "—"}
                  </p>
                </div>
                <StatusPill tone={form.isSeasonalAvailable ? "accent" : "neutral"} dot>
                  {form.isSeasonalAvailable ? "בעונה" : "לא בעונה"}
                </StatusPill>
              </div>

              <FormSection title="זיהוי" columns={2}>
                <FormField label="משפחה" htmlFor="product-family">
                  <select
                    id="product-family"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.familyId}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, familyId: event.target.value }))
                    }
                  >
                    {familiesQuery.data?.map((family) => (
                      <option key={family.id} value={family.id}>
                        {family.name}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="זן / שם" htmlFor="product-name">
                  <input
                    id="product-name"
                    required
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </FormField>

                <FormField label="גדלים" htmlFor="product-sizes">
                  <input
                    id="product-sizes"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.sizes}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, sizes: event.target.value }))
                    }
                  />
                </FormField>

                <FormField label="סוג אריזה" htmlFor="product-pack-type">
                  <select
                    id="product-pack-type"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.packType}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        packType: event.target.value as PackType | "",
                      }))
                    }
                  >
                    <option value="">—</option>
                    <option value="pallets">משטחים</option>
                    <option value="crates">ארגזים</option>
                  </select>
                </FormField>
              </FormSection>

              <FormSection
                title="תמחור"
                hint="מחיר קבוע, או טווח מ-/עד. השאר ריק את מה שלא רלוונטי."
              >
                <div className="grid grid-cols-3 gap-4">
                  <FormField label="מחיר" htmlFor="product-price">
                    <input
                      id="product-price"
                      type="number"
                      step="0.01"
                      disabled={!editing}
                      className={`${inputClassName} w-full`}
                      value={form.price}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, price: event.target.value }))
                      }
                    />
                  </FormField>
                  <FormField label="טווח מ-" htmlFor="product-price-from">
                    <input
                      id="product-price-from"
                      type="number"
                      step="0.01"
                      disabled={!editing}
                      className={`${inputClassName} w-full`}
                      value={form.priceRangeFrom}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, priceRangeFrom: event.target.value }))
                      }
                    />
                  </FormField>
                  <FormField label="טווח עד" htmlFor="product-price-to">
                    <input
                      id="product-price-to"
                      type="number"
                      step="0.01"
                      disabled={!editing}
                      className={`${inputClassName} w-full`}
                      value={form.priceRangeTo}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, priceRangeTo: event.target.value }))
                      }
                    />
                  </FormField>
                </div>

                <FormField label="סוג תמחור" htmlFor="product-price-type">
                  <input
                    id="product-price-type"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.priceType}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, priceType: event.target.value }))
                    }
                  />
                </FormField>

                <label
                  className={`flex items-start gap-2.5 rounded-lg bg-surface-muted/60 px-3.5 py-3 text-sm ring-1 ring-inset ring-border ${
                    editing ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={!editing}
                    checked={form.highlightPriceFluctuations}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        highlightPriceFluctuations: event.target.checked,
                      }))
                    }
                  />
                  <span className="font-medium text-ink">הדגש תנודות מחיר</span>
                </label>
              </FormSection>

              <FormSection title="זמינות ומלאי">
                <FormField label="חריגת הזמנה מותרת (No Overbooking)" htmlFor="product-overbooking">
                  <input
                    id="product-overbooking"
                    type="number"
                    step="1"
                    min={0}
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.noOverbooking}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, noOverbooking: event.target.value }))
                    }
                  />
                </FormField>

                {/* The customer order screen's dropdown (order-product-list.tsx)
                    reads this as its own ceiling — never applied to a backoffice
                    on-behalf-of edit, where staff may deliberately exceed it. Empty
                    means uncapped: the dropdown is then bounded by remaining stock
                    alone. See product-variety.ts's schema comment for how this
                    differs from the per-customer caps below (one default for every
                    customer vs. an override for one). */}
                <FormField
                  label="כמות מקסימלית להזמנה ללקוח (Number of Orders per Customer)"
                  htmlFor="product-order-cap"
                >
                  <input
                    id="product-order-cap"
                    type="number"
                    step="1"
                    min={0}
                    placeholder="ללא הגבלה"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.numberOfOrdersPerCustomer}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, numberOfOrdersPerCustomer: event.target.value }))
                    }
                  />
                </FormField>

                <label
                  className={`flex items-start gap-2.5 rounded-lg bg-surface-muted/60 px-3.5 py-3 text-sm ring-1 ring-inset ring-border ${
                    editing ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={!editing}
                    checked={form.isSeasonalAvailable}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        isSeasonalAvailable: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    <span className="block font-medium text-ink">זמין בעונה הנוכחית</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      כשמכובה, הזן לא יופיע בחנות ולא ברשימות הליקוט.
                    </span>
                  </span>
                </label>
              </FormSection>

              <FormField label="תקרת משטחים ללקוח" htmlFor="product-pallet-caps">
                <div className="flex flex-col gap-2">
                  {form.customerPalletCaps.map((cap, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <select
                        disabled={!editing}
                        className={`${inputClassName} flex-1`}
                        value={cap.customerCompanyId}
                        onChange={(event) =>
                          updateCap(index, { customerCompanyId: event.target.value })
                        }
                      >
                        {customersQuery.data?.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        disabled={!editing}
                        className={`${inputClassName} w-24`}
                        value={cap.palletCap}
                        onChange={(event) =>
                          updateCap(index, { palletCap: Number(event.target.value) })
                        }
                      />
                      {editing && (
                        <Button type="button" variant="ghost" onClick={() => removeCap(index)}>
                          הסר
                        </Button>
                      )}
                    </div>
                  ))}
                  {editing && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={addCap}
                      disabled={!customersQuery.data?.length}
                    >
                      הוסף תקרה
                    </Button>
                  )}
                </div>
              </FormField>

              <ActionBar
                editing={editing}
                saving={saving}
                dirty={dirty}
                canDelete={!!selectedId}
                onEdit={() => setEditing(true)}
                onDiscard={handleDiscard}
                onSave={handleSave}
                onDelete={selectedId ? () => setDeleteOpen(true) : undefined}
              />
            </div>
          )
        }
      />
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="מחיקת מוצר">
        <p className="mb-4 text-sm">
          האם למחוק את המוצר &quot;{selected?.name}&quot;? פעולה זו אינה הפיכה.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
            ביטול
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "מוחק…" : "מחק"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
