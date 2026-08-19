"use client";

import {
  PRODUCT_VERSION_CONFLICT_ERROR_CODE,
  saveProductInputSchema,
  toSaveProductRpcArgs,
} from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ActionBar } from "@/components/reference-data/action-bar";
import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { ListDetailLayout } from "@/components/reference-data/list-detail-layout";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
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
          "id, family_id, name, sizes, pack_type, price, price_range_from, price_range_to, price_type, no_overbooking, highlight_price_fluctuations, is_seasonal_available, version, product_families(name)",
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

  function handleDiscard() {
    setForm(
      selected && capsQuery.data
        ? toFormState(selected, capsQuery.data)
        : blankForm(familiesQuery.data?.[0]?.id ?? ""),
    );
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
        header={<PageHeader title="מוצרים" subtitle="קטלוג הזנים: מחירים, אוברבוקינג, עונתיות ומגבלות ללקוח." />}
        list={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <Button type="button" onClick={handleNew} disabled={!familiesQuery.data?.length}>
              מוצר חדש
            </Button>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface">
              {productsQuery.isLoading ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <ul>
                  {productsQuery.data?.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(row.id)}
                        className={`block w-full border-b border-border px-4 py-3 text-start text-sm hover:bg-canvas ${
                          row.id === selectedId ? "bg-canvas font-medium" : ""
                        }`}
                      >
                        {row.product_families?.name
                          ? `${row.product_families.name} — ${row.name}`
                          : row.name}
                        {!row.is_seasonal_available && (
                          <span className="ms-2 text-xs text-ink-muted">(לא בעונה)</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        }
        detail={
          selectedId === null && !editing ? (
            <p className="text-sm text-ink-muted">בחר מוצר מהרשימה, או צור מוצר חדש.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <FormField label="משפחה" htmlFor="product-family">
                <select
                  id="product-family"
                  disabled={!editing}
                  className={inputClassName}
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
                  className={inputClassName}
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
                  className={inputClassName}
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
                  className={inputClassName}
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

              <div className="grid grid-cols-3 gap-3">
                <FormField label="מחיר" htmlFor="product-price">
                  <input
                    id="product-price"
                    type="number"
                    step="0.01"
                    disabled={!editing}
                    className={inputClassName}
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
                    className={inputClassName}
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
                    className={inputClassName}
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
                  className={inputClassName}
                  value={form.priceType}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, priceType: event.target.value }))
                  }
                />
              </FormField>

              <FormField label="חריגת הזמנה מותרת (No Overbooking)" htmlFor="product-overbooking">
                <input
                  id="product-overbooking"
                  type="number"
                  step="0.01"
                  disabled={!editing}
                  className={inputClassName}
                  value={form.noOverbooking}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, noOverbooking: event.target.value }))
                  }
                />
              </FormField>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!editing}
                  checked={form.isSeasonalAvailable}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      isSeasonalAvailable: event.target.checked,
                    }))
                  }
                />
                זמין בעונה הנוכחית
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!editing}
                  checked={form.highlightPriceFluctuations}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      highlightPriceFluctuations: event.target.checked,
                    }))
                  }
                />
                הדגש תנודות מחיר
              </label>

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
