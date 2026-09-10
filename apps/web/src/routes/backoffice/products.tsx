import {
  PRODUCT_VERSION_CONFLICT_ERROR_CODE,
  saveProductInputSchema,
  toSaveProductRpcArgs,
} from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { CellChipList, CellPopover } from "@/components/reference-data/cell-popover";
import { checkboxClassName, inputClassName } from "@/components/reference-data/form-field";
import { RecordTable, type RecordTableColumn } from "@/components/reference-data/record-table";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { hasChanges } from "@/lib/has-changes";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
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
  created_at: string;
}

type ProductRow = ProductVariety & {
  product_families: { name: string; category: string | null; image_url: string | null } | null;
};

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

// Sentinel row id for a not-yet-created record: the draft row prepended to
// the table while `onAdd` is active, so RecordTable's "is this row being
// edited" logic (which compares ids) needs no separate create/update
// concept of its own.
const NEW_ROW_ID = "__new__";

const CREATED_AT_FORMAT = new Intl.DateTimeFormat("he-IL", { dateStyle: "short" });

const PACK_TYPE_LABEL: Record<PackType, string> = { pallets: "משטחים", crates: "ארגזים" };

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

function blankRow(): ProductRow {
  return {
    id: NEW_ROW_ID,
    family_id: "",
    name: "",
    sizes: null,
    pack_type: null,
    price: null,
    price_range_from: null,
    price_range_to: null,
    price_type: null,
    no_overbooking: "0",
    highlight_price_fluctuations: false,
    is_seasonal_available: true,
    number_of_orders_per_customer: null,
    version: 0,
    created_at: "",
    product_families: null,
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
// overbooking, and the per-customer pallet cap control. `save_product` is
// where the conflict-prevention rule actually lives (R7): every save
// carries the version this form last loaded, and a rejection means someone
// else saved first — surfaced here as a clear message and a forced reload,
// never a silent overwrite and never a UI "someone's editing this" lock.
export default function ProductsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Which row (by id) is being edited inline right now — NEW_ROW_ID for a
  // draft that hasn't been saved yet, an existing row's own id, or null.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm(""));
  const [saving, setSaving] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const productsQueryKey = ["reference-data", "products"] as const;
  const capsQueryKey = ["reference-data", "product-customer-caps-all"] as const;

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
    queryKey: productsQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_varieties")
        .select(
          "id, family_id, name, sizes, pack_type, price, price_range_from, price_range_to, price_type, no_overbooking, highlight_price_fluctuations, is_seasonal_available, number_of_orders_per_customer, version, created_at, product_families(name, category, image_url)",
        )
        .order("name");
      if (error) throw error;
      return data as ProductRow[];
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
  const customerNameById = useMemo(
    () => new Map((customersQuery.data ?? []).map((row) => [row.id, row.name])),
    [customersQuery.data],
  );

  // Every variety's per-customer caps in ONE read, grouped client-side —
  // same reasoning as growers.tsx's identical bulk read: the caps are a
  // column now, so every visible row needs its own value.
  const capsQuery = useQuery({
    queryKey: capsQueryKey,
    queryFn: async () => {
      const rows = await fetchAllRows<{
        product_variety_id: string;
        customer_company_id: string;
        pallet_cap: number;
      }>((from, to) =>
        supabase
          .from("product_customer_caps")
          .select("product_variety_id, customer_company_id, pallet_cap")
          .range(from, to),
      );
      const byVariety = new Map<string, PalletCap[]>();
      for (const row of rows) {
        const cap = { customerCompanyId: row.customer_company_id, palletCap: row.pallet_cap };
        const list = byVariety.get(row.product_variety_id);
        if (list) list.push(cap);
        else byVariety.set(row.product_variety_id, [cap]);
      }
      return byVariety;
    },
  });

  const editingRowId = editingId !== null && editingId !== NEW_ROW_ID ? editingId : null;
  const selected = productsQuery.data?.find((row) => row.id === editingRowId) ?? null;
  const deleteTarget = productsQuery.data?.find((row) => row.id === deleteTargetId) ?? null;

  // Patches every field the form edits except `version` — that's a real
  // optimistic-concurrency column, bumped by the server only. Leaving it
  // alone here means a stale version still gets caught by the real
  // PRODUCT_VERSION_CONFLICT_ERROR_CODE check below; faking a bump here
  // would just teach the UI to trust a number the server hasn't agreed to.
  const saveOptimistic = optimisticUpdate<ProductRow[], void>(
    queryClient,
    productsQueryKey,
    (rows) =>
      rows?.map((row) =>
        row.id === editingRowId
          ? {
              ...row,
              family_id: form.familyId,
              name: form.name,
              sizes: form.sizes || null,
              pack_type: form.packType || null,
              price: form.price === "" ? null : form.price,
              price_range_from: form.priceRangeFrom === "" ? null : form.priceRangeFrom,
              price_range_to: form.priceRangeTo === "" ? null : form.priceRangeTo,
              price_type: form.priceType || null,
              no_overbooking: form.noOverbooking || "0",
              highlight_price_fluctuations: form.highlightPriceFluctuations,
              is_seasonal_available: form.isSeasonalAvailable,
              number_of_orders_per_customer:
                form.numberOfOrdersPerCustomer === ""
                  ? null
                  : Number(form.numberOfOrdersPerCustomer),
            }
          : row,
      ),
  );

  const saveCapsOptimistic = optimisticUpdate<Map<string, PalletCap[]>, void>(
    queryClient,
    capsQueryKey,
    (byVariety) => {
      if (!byVariety || !editingRowId) return byVariety;
      const next = new Map(byVariety);
      next.set(editingRowId, form.customerPalletCaps);
      return next;
    },
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = saveProductInputSchema.parse({
        id: editingRowId,
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
    onMutate: async (variables) => {
      const rows = await saveOptimistic.onMutate(variables);
      const caps = await saveCapsOptimistic.onMutate(variables);
      return { rows, caps };
    },
    onSuccess: () => {
      showToast("הנתונים נשמרו.", "success");
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: productsQueryKey });
      void queryClient.invalidateQueries({ queryKey: capsQueryKey });
    },
    onError: async (
      error: { message?: string; code?: string },
      variables,
      context:
        | {
            rows: { previous: ProductRow[] | undefined } | undefined;
            caps: { previous: Map<string, PalletCap[]> | undefined } | undefined;
          }
        | undefined,
    ) => {
      saveOptimistic.onError(error, variables, context?.rows);
      saveCapsOptimistic.onError(error, variables, context?.caps);

      if (error.code !== PRODUCT_VERSION_CONFLICT_ERROR_CODE) {
        showToast(`השמירה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
        return;
      }

      // Someone else saved this product first (R7). Refetch and re-seed the
      // row that's still open for editing from the values that actually
      // won, so the next save carries THEIR version rather than retrying
      // against a version the server has already moved past.
      showToast("המוצר עודכן על ידי משתמש אחר בינתיים. הנתונים רועננו — בדוק ושמור שוב.", "error");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productsQueryKey }),
        queryClient.invalidateQueries({ queryKey: capsQueryKey }),
      ]);
      if (!editingRowId) return;
      const fresh = queryClient
        .getQueryData<ProductRow[]>(productsQueryKey)
        ?.find((row) => row.id === editingRowId);
      if (!fresh) {
        setEditingId(null);
        return;
      }
      const caps = queryClient.getQueryData<Map<string, PalletCap[]>>(capsQueryKey)?.get(fresh.id);
      setForm(toFormState(fresh, caps ?? []));
    },
  });

  const deleteOptimistic = optimisticUpdate<ProductRow[], void>(
    queryClient,
    productsQueryKey,
    (rows) => rows?.filter((row) => row.id !== deleteTargetId),
  );

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTargetId) return;
      const { error } = await supabase.from("product_varieties").delete().eq("id", deleteTargetId);
      if (error) throw error;
    },
    onMutate: deleteOptimistic.onMutate,
    onSuccess: () => {
      showToast("המוצר נמחק.", "success");
      setDeleteTargetId(null);
      void queryClient.invalidateQueries({ queryKey: productsQueryKey });
    },
    onError: mergeOnError(deleteOptimistic.onError, (error: { message?: string }) => {
      showToast(`המחיקה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
      setDeleteTargetId(null);
    }),
  });

  // Seeded synchronously from data the table already has — the caps are
  // loaded up front for their column, not lazily on click.
  function handleEditRow(row: ProductRow) {
    setEditingId(row.id);
    setForm(toFormState(row, capsQuery.data?.get(row.id) ?? []));
  }

  function handleNew() {
    setEditingId(NEW_ROW_ID);
    setForm(blankForm(familiesQuery.data?.[0]?.id ?? ""));
  }

  function handleCancel() {
    setEditingId(null);
  }

  // What the form would hold with no unsaved edits — decides whether the
  // save button has anything to do.
  //
  // `version` rides along inside FormState but can never differ between the
  // two sides: nothing in this form edits it, and a save that bumps it also
  // re-seeds the form from the returned row. It is the optimistic-locking
  // token (R7), not a field, so it neither can nor should make the form read
  // as changed.
  const baselineForm = selected
    ? toFormState(selected, capsQuery.data?.get(selected.id) ?? [])
    : blankForm(familiesQuery.data?.[0]?.id ?? "");
  const dirty = hasChanges(form, baselineForm);

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

  const columns: RecordTableColumn<ProductRow>[] = [
    {
      key: "image",
      label: "תמונה",
      // The photo belongs to the family, not the variety — this screen
      // edits varieties, so it's shown, not edited.
      render: (row) =>
        row.product_families?.image_url ? (
          <img
            src={row.product_families.image_url}
            alt=""
            className="h-9 w-9 rounded-md object-cover ring-1 ring-inset ring-border"
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-muted text-ink-subtle ring-1 ring-inset ring-border">
            —
          </span>
        ),
    },
    {
      key: "name",
      label: "זן",
      render: (row) => <span className="font-medium text-ink">{row.name}</span>,
      renderEdit: () => (
        <input
          aria-label="זן / שם"
          autoFocus
          required
          className={`${inputClassName} w-full min-w-[9rem]`}
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        />
      ),
    },
    {
      key: "family",
      label: "משפחה",
      render: (row) => row.product_families?.name ?? "—",
      renderEdit: () => (
        <select
          aria-label="משפחה"
          className={`${inputClassName} w-full min-w-[8rem]`}
          value={form.familyId}
          onChange={(event) => setForm((current) => ({ ...current, familyId: event.target.value }))}
        >
          {familiesQuery.data?.map((family) => (
            <option key={family.id} value={family.id}>
              {family.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "category",
      label: "קטגוריה",
      // A family-level field (PRD: Product Family's Category). Shown per
      // variety because it's part of what identifies the row, read-only
      // because editing it here would silently retag every other variety in
      // the same family.
      render: (row) => row.product_families?.category || "—",
    },
    {
      key: "sizes",
      label: "גודל",
      render: (row) => row.sizes || "—",
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
      render: (row) => (row.pack_type ? PACK_TYPE_LABEL[row.pack_type] : "—"),
      renderEdit: () => (
        <select
          aria-label="סוג אריזה"
          className={`${inputClassName} w-28`}
          value={form.packType}
          onChange={(event) =>
            setForm((current) => ({ ...current, packType: event.target.value as PackType | "" }))
          }
        >
          <option value="">—</option>
          <option value="pallets">משטחים</option>
          <option value="crates">ארגזים</option>
        </select>
      ),
    },
    {
      key: "price",
      label: "מחיר",
      render: (row) => row.price || "—",
      renderEdit: () => (
        <input
          type="number"
          step="0.01"
          aria-label="מחיר"
          className={`${inputClassName} w-24`}
          value={form.price}
          onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
        />
      ),
    },
    {
      key: "priceFrom",
      label: "טווח מ-",
      render: (row) => row.price_range_from || "—",
      renderEdit: () => (
        <input
          type="number"
          step="0.01"
          aria-label="טווח מ-"
          className={`${inputClassName} w-24`}
          value={form.priceRangeFrom}
          onChange={(event) =>
            setForm((current) => ({ ...current, priceRangeFrom: event.target.value }))
          }
        />
      ),
    },
    {
      key: "priceTo",
      label: "טווח עד",
      render: (row) => row.price_range_to || "—",
      renderEdit: () => (
        <input
          type="number"
          step="0.01"
          aria-label="טווח עד"
          className={`${inputClassName} w-24`}
          value={form.priceRangeTo}
          onChange={(event) =>
            setForm((current) => ({ ...current, priceRangeTo: event.target.value }))
          }
        />
      ),
    },
    {
      key: "priceType",
      label: "סוג מחיר",
      render: (row) => row.price_type || "—",
      renderEdit: () => (
        <input
          aria-label="סוג תמחור"
          className={`${inputClassName} w-28`}
          value={form.priceType}
          onChange={(event) => setForm((current) => ({ ...current, priceType: event.target.value }))}
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
      render: (row) => row.number_of_orders_per_customer ?? "—",
      renderEdit: () => (
        <input
          type="number"
          step="1"
          min={0}
          placeholder="ללא הגבלה"
          aria-label="כמות מקסימלית להזמנה ללקוח (Number of Orders per Customer)"
          className={`${inputClassName} w-28`}
          value={form.numberOfOrdersPerCustomer}
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
                <select
                  aria-label="לקוח"
                  className={`${inputClassName} min-w-0 flex-1`}
                  value={cap.customerCompanyId}
                  onChange={(event) => updateCap(index, { customerCompanyId: event.target.value })}
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
                  aria-label="תקרת משטחים"
                  className={`${inputClassName} w-20`}
                  value={cap.palletCap}
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
        row.created_at ? CREATED_AT_FORMAT.format(new Date(row.created_at)) : "—",
    },
  ];

  const rows =
    editingId === NEW_ROW_ID
      ? [blankRow(), ...(productsQuery.data ?? [])]
      : (productsQuery.data ?? []);

  return (
    <>
      <PageHeader
        title="מוצרים"
        subtitle="קטלוג הזנים: מחירים, אוברבוקינג, עונתיות ומגבלות ללקוח."
      />
      <RecordTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        searchText={(row) => `${row.name} ${row.product_families?.name ?? ""}`}
        editingId={editingId}
        savingEdit={saving}
        dirtyEdit={dirty}
        onEdit={handleEditRow}
        onSaveEdit={handleSave}
        onCancelEdit={handleCancel}
        onDelete={(row) => setDeleteTargetId(row.id)}
        onAdd={handleNew}
        addLabel="מוצר חדש"
        loading={productsQuery.isLoading || capsQuery.isLoading}
        searchPlaceholder="חיפוש מוצר או זן"
        emptyLabel="אין מוצרים עדיין."
      />

      <Dialog open={deleteTargetId !== null} onClose={() => setDeleteTargetId(null)} title="מחיקת מוצר">
        <p className="mb-4 text-sm">
          האם למחוק את המוצר &quot;{deleteTarget?.name}&quot;? פעולה זו אינה הפיכה.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTargetId(null)}>
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
