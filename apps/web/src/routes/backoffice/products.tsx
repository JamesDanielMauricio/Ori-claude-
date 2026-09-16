import {
  PRODUCT_VERSION_CONFLICT_ERROR_CODE,
  saveProductInputSchema,
  toSaveProductRpcArgs,
} from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { CellChipList, CellPopover } from "@/components/reference-data/cell-popover";
import { checkboxClassName, inputClassName } from "@/components/reference-data/form-field";
import {
  RecordTable,
  RowIconButton,
  type RecordTableColumn,
  type RecordTableGroup,
  type RecordTableGroupContent,
} from "@/components/reference-data/record-table";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { ProductThumbnail } from "@/components/ui/product-thumbnail";
import { StatusPill } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { hasChanges } from "@/lib/has-changes";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";
import { formatVarietyName } from "@/lib/variety-label";

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

// The catalog's grouping level, and a record in its own right — this screen
// edits both halves. Fetched as its own list rather than read off each
// variety's embedded copy (which is what the old flat table did): a family
// with no varieties yet has no variety row to be embedded in, and it still
// needs a header row of its own to be renamed or photographed from.
interface ProductFamily {
  id: string;
  name: string;
  category: string | null;
  image_url: string | null;
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

// Sentinel row id for a not-yet-created record: the draft row prepended to
// the table while `onAdd` is active, so RecordTable's "is this row being
// edited" logic (which compares ids) needs no separate create/update
// concept of its own.
const NEW_ROW_ID = "__new__";

// The same idea one level up: a not-yet-created FAMILY, prepended to the
// group list as a header row already in edit mode. RecordTable pins the
// group whose id is `editingId`, so an unnamed draft survives whatever is
// in the search box.
const NEW_FAMILY_ID = "__new_family__";

const CREATED_AT_FORMAT = new Intl.DateTimeFormat("he-IL", { dateStyle: "short" });

const PACK_TYPE_LABEL: Record<PackType, string> = { pallets: "משטחים", crates: "ארגזים" };

// An empty cell is a value too, and on this screen most varieties leave most
// of the optional pricing fields unset — so a placeholder drawn in the same
// ink as real data turns the table into a field of dashes with the handful of
// actual numbers lost somewhere inside it. Drawn in the subtle ink instead:
// still plainly "nothing set here", but no longer competing with the values
// that ARE set. An empty string counts as unset for the same reason `||` did
// before: these columns come back as "" rather than null when the source row
// has never been given one.
function orDash(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-ink-subtle">—</span>;
  }
  return value;
}

// The name column carries a family's expand chevron and photo as well as a
// name — and those two pushed the family name 4rem inboard of the varieties
// listed directly underneath it, so the parent read as drifting away from its
// own children. They now sit in a fixed-width gutter instead, and a variety's
// name is padded by exactly that width, which puts every name in the column
// on one edge whichever level it belongs to. Two halves of one measurement,
// so they are declared together and must stay equal: `w-16` is 4rem and so is
// `ps-16`. It costs the column nothing, because its width was already set by
// the longest family name plus this same gutter.
const NAME_GUTTER = "w-16";
const NAME_GUTTER_PAD = "ps-16";

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

// `familyId` is the one field the draft row carries for real: the table
// buckets rows into family groups by it, so a draft that held "" would sit
// in no family at all and render outside every group. Threading the form's
// current selection through means changing the משפחה dropdown mid-draft
// visibly moves the half-filled row into the family it will be saved to.
function blankRow(familyId: string): ProductVariety {
  return {
    id: NEW_ROW_ID,
    family_id: familyId,
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
  };
}

interface FamilyFormState {
  name: string;
  category: string;
  imageUrl: string;
}

function blankFamilyForm(): FamilyFormState {
  return { name: "", category: "", imageUrl: "" };
}

function toFamilyForm(family: ProductFamily): FamilyFormState {
  return {
    name: family.name,
    category: family.category ?? "",
    imageUrl: family.image_url ?? "",
  };
}

// Hebrew takes no bare numeral before a plural for one: "1 זנים" is wrong
// where "זן אחד" is right, and an empty family reads as "אין זנים" rather
// than "0 זנים". Used by both the header chip and the delete dialog's
// explanation, so the two can't disagree about how to count.
function varietyCountLabel(count: number): string {
  if (count === 0) return "אין זנים";
  if (count === 1) return "זן אחד";
  return `${count} זנים`;
}

// The synthetic family a draft header row is drawn from. Only the id is
// ever read while it's on screen — every field shown comes from
// `familyForm` — but it keeps the header renderer working off one type
// instead of branching on "is this a real family or a draft".
function blankFamily(): ProductFamily {
  return { id: NEW_FAMILY_ID, name: "", category: null, image_url: null };
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

  // The catalog's second editable level. Families are their own record with
  // their own form and their own save, deliberately kept apart from the
  // variety form above: the two never open at once (each locks the other —
  // see `tableEditingId` below), so one screen still only ever has one form
  // and one save button live at a time.
  const [editingFamilyId, setEditingFamilyId] = useState<string | null>(null);
  const [familyForm, setFamilyForm] = useState<FamilyFormState>(blankFamilyForm);
  const [savingFamily, setSavingFamily] = useState(false);
  const [deleteFamilyTargetId, setDeleteFamilyTargetId] = useState<string | null>(null);

  // Which families are open. Everything starts collapsed: the catalog runs
  // to ~78 families and ~600 varieties, and a screen that opens every one of
  // them is the flat table this grouping replaced.
  const [expandedFamilyIds, setExpandedFamilyIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const productsQueryKey = ["reference-data", "products"] as const;
  const capsQueryKey = ["reference-data", "product-customer-caps-all"] as const;
  const familiesQueryKey = ["reference-data", "product-families"] as const;

  const familiesQuery = useQuery({
    queryKey: familiesQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_families")
        .select("id, name, category, image_url")
        .order("name");
      if (error) throw error;
      return data as ProductFamily[];
    },
  });
  const familyById = useMemo(
    () => new Map((familiesQuery.data ?? []).map((family) => [family.id, family])),
    [familiesQuery.data],
  );

  const productsQuery = useQuery({
    queryKey: productsQueryKey,
    queryFn: async () => {
      // No embedded `product_families(...)` any more: the family's name,
      // category and photo are read from familiesQuery via `familyById`, so
      // there is one copy of each family on this screen rather than one per
      // variety — which also means a family edit doesn't leave ~600 stale
      // duplicates behind in this cache until it refetches.
      const { data, error } = await supabase
        .from("product_varieties")
        .select(
          "id, family_id, name, sizes, pack_type, price, price_range_from, price_range_to, price_type, no_overbooking, highlight_price_fluctuations, is_seasonal_available, number_of_orders_per_customer, version, created_at",
        )
        .order("name");
      if (error) throw error;
      return data as ProductVariety[];
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
  const saveOptimistic = optimisticUpdate<ProductVariety[], void>(
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
            rows: { previous: ProductVariety[] | undefined } | undefined;
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
        .getQueryData<ProductVariety[]>(productsQueryKey)
        ?.find((row) => row.id === editingRowId);
      if (!fresh) {
        setEditingId(null);
        return;
      }
      const caps = queryClient.getQueryData<Map<string, PalletCap[]>>(capsQueryKey)?.get(fresh.id);
      setForm(toFormState(fresh, caps ?? []));
    },
  });

  const deleteOptimistic = optimisticUpdate<ProductVariety[], void>(
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

  const editingFamily = familyById.get(editingFamilyId ?? "") ?? null;

  const saveFamilyOptimistic = optimisticUpdate<ProductFamily[], void>(
    queryClient,
    familiesQueryKey,
    (families) =>
      families?.map((family) =>
        family.id === editingFamilyId
          ? {
              ...family,
              name: familyForm.name.trim(),
              category: familyForm.category.trim() || null,
              image_url: familyForm.imageUrl.trim() || null,
            }
          : family,
      ),
  );

  // A plain table write, not an RPC like `save_product` — a family is three
  // independent text columns with no child rows to keep in step and no
  // `version` column, so there is nothing here for a transaction-scoped
  // function to make atomic. The write is allowed by the
  // `product_families_write_backoffice` policy
  // (0006_reference-data-rls.sql): only a signed-in user whose
  // `current_role()` is 'backoffice' may insert/update/delete a family,
  // while every authenticated role may read them — which is what stops a
  // grower or a customer renaming the catalog everyone else orders from,
  // and it is enforced in the database, not by this screen being
  // backoffice-only.
  //
  // Editing a family carries no optimistic-concurrency check by design:
  // unlike a variety (R7, where two distributors pricing the same product
  // in the same minute is a real and costly collision), a family's name,
  // category and photo are near-static and a last-write-wins overwrite of
  // one of three text fields is recoverable by retyping it.
  const saveFamilyMutation = useMutation({
    mutationFn: async () => {
      if (!editingFamilyId) return;
      const values = {
        name: familyForm.name.trim(),
        category: familyForm.category.trim() || null,
        image_url: familyForm.imageUrl.trim() || null,
      };
      // Create and update are the same three columns, so they're the same
      // form and the same button — only the verb differs, exactly as the
      // variety half of this screen treats its own draft row.
      const { error } =
        editingFamilyId === NEW_FAMILY_ID
          ? await supabase.from("product_families").insert(values)
          : await supabase.from("product_families").update(values).eq("id", editingFamilyId);
      if (error) throw error;
    },
    onMutate: saveFamilyOptimistic.onMutate,
    onSuccess: () => {
      showToast(editingFamilyId === NEW_FAMILY_ID ? "המשפחה נוצרה." : "המשפחה נשמרה.", "success");
      setEditingFamilyId(null);
      void queryClient.invalidateQueries({ queryKey: familiesQueryKey });
    },
    onError: mergeOnError(saveFamilyOptimistic.onError, (error: { message?: string }) => {
      showToast(`שמירת המשפחה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    }),
  });

  const deleteFamilyOptimistic = optimisticUpdate<ProductFamily[], void>(
    queryClient,
    familiesQueryKey,
    (families) => families?.filter((family) => family.id !== deleteFamilyTargetId),
  );

  const deleteFamilyMutation = useMutation({
    mutationFn: async () => {
      if (!deleteFamilyTargetId) return;
      const { error } = await supabase
        .from("product_families")
        .delete()
        .eq("id", deleteFamilyTargetId);
      if (error) throw error;
    },
    onMutate: deleteFamilyOptimistic.onMutate,
    onSuccess: () => {
      showToast("המשפחה נמחקה.", "success");
      setDeleteFamilyTargetId(null);
      void queryClient.invalidateQueries({ queryKey: familiesQueryKey });
    },
    onError: mergeOnError(deleteFamilyOptimistic.onError, (error: { message?: string }) => {
      showToast(`מחיקת המשפחה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
      setDeleteFamilyTargetId(null);
    }),
  });

  // A draft family's baseline is the blank form, so "שמור" lights up the
  // moment a name is typed; an existing one's is what the server holds.
  const familyBaseline =
    editingFamilyId === NEW_FAMILY_ID
      ? blankFamilyForm()
      : editingFamily
        ? toFamilyForm(editingFamily)
        : null;
  const familyDirty = familyBaseline ? hasChanges(familyForm, familyBaseline) : false;

  function openFamily(familyId: string) {
    setExpandedFamilyIds((current) => {
      if (current.has(familyId)) return current;
      const next = new Set(current);
      next.add(familyId);
      return next;
    });
  }

  function toggleFamily(familyId: string) {
    setExpandedFamilyIds((current) => {
      const next = new Set(current);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  }

  function handleEditFamily(family: ProductFamily) {
    setEditingFamilyId(family.id);
    setFamilyForm(toFamilyForm(family));
  }

  function handleNewFamily() {
    setEditingId(null);
    setEditingFamilyId(NEW_FAMILY_ID);
    setFamilyForm(blankFamilyForm());
  }

  function handleCancelFamily() {
    setEditingFamilyId(null);
  }

  function handleSaveFamily() {
    setSavingFamily(true);
    saveFamilyMutation.mutate(undefined, { onSettled: () => setSavingFamily(false) });
  }

  // Seeded synchronously from data the table already has — the caps are
  // loaded up front for their column, not lazily on click.
  //
  // The row's family is opened here rather than left to RecordTable's own
  // "keep the editing row visible" rule, because that rule lapses the
  // instant the edit ends: a variety saved inside a collapsed family would
  // disappear at the moment the user is looking for confirmation it landed.
  function handleEditRow(row: ProductVariety) {
    setEditingId(row.id);
    openFamily(row.family_id);
    setForm(toFormState(row, capsQuery.data?.get(row.id) ?? []));
  }

  // Starts a draft variety already assigned to one family. The family is
  // opened as well as selected, because the draft row is grouped by the
  // family the FORM names (see `getGroupId`) — into a collapsed group it
  // would be seeded correctly and then be invisible.
  function handleNewInFamily(familyId: string) {
    setEditingId(NEW_ROW_ID);
    openFamily(familyId);
    setForm(blankForm(familyId));
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

  // The two family-level fields the flat table used to repeat on every
  // variety row — the photo and the category — are gone from the columns
  // below. They now appear once, on their family's own header row, where
  // they are also editable; keeping a read-only copy per variety would show
  // the same value in two places and let only one of them be changed.
  const columns: RecordTableColumn<ProductVariety>[] = [
    {
      key: "name",
      label: "זן",
      groupLabel: "משפחה",
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

  const rows =
    editingId === NEW_ROW_ID
      ? [blankRow(form.familyId), ...(productsQuery.data ?? [])]
      : (productsQuery.data ?? []);

  // How many varieties each family holds, counted off the full catalog
  // rather than off what the search left standing: the number on a header
  // row answers "how big is this family", which doesn't change because
  // someone typed in the search box.
  const varietyCountByFamily = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of productsQuery.data ?? []) {
      counts.set(row.family_id, (counts.get(row.family_id) ?? 0) + 1);
    }
    return counts;
  }, [productsQuery.data]);

  const deleteFamilyTarget = familyById.get(deleteFamilyTargetId ?? "") ?? null;
  const deleteFamilyVarietyCount = deleteFamilyTargetId
    ? (varietyCountByFamily.get(deleteFamilyTargetId) ?? 0)
    : 0;

  // Only one form is live on this screen at a time. Handing RecordTable the
  // family's id while a family is being edited locks every variety row's
  // edit/delete and the add button exactly as a row edit does, and routes
  // Escape to the family form's own cancel.
  const tableEditingId = editingFamilyId ?? editingId;

  const toGroup = (family: ProductFamily): RecordTableGroup => ({
    id: family.id,
    // The family's own name and category, so searching "פירות" finds a
    // family whose varieties never mention the word.
    searchText: `${family.name} ${family.category ?? ""}`,
    header: (expanded) =>
      renderFamilyHeader(family, varietyCountByFamily.get(family.id) ?? 0, expanded),
  });

  // A new family's draft header sits at the top of the table, the same
  // place — and for the same reason — the draft VARIETY row goes: the row
  // you just asked for is where you are already looking, not somewhere
  // alphabetical you have to hunt for.
  const groups: RecordTableGroup[] = [
    ...(editingFamilyId === NEW_FAMILY_ID ? [toGroup(blankFamily())] : []),
    ...(familiesQuery.data ?? []).map(toGroup),
  ];

  function renderFamilyHeader(
    family: ProductFamily,
    varietyCount: number,
    expanded: boolean,
  ): RecordTableGroupContent {
    const isEditing = editingFamilyId === family.id;
    const isDraft = family.id === NEW_FAMILY_ID;
    // Locked while any OTHER edit is open — a row's, or another family's.
    const locked = tableEditingId !== null && !isEditing;

    // The family's expand toggle, drawn wherever the caller of this helper
    // puts it. It stays available while the family is being edited —
    // renaming a family and checking what's inside it are independent, and
    // taking the chevron away mid-edit would be a dead end. A draft family
    // has nothing to expand onto, so it gets a plain thumbnail instead.
    const toggle = isDraft ? (
      <ProductThumbnail imageUrl={familyForm.imageUrl} size="sm" />
    ) : (
      <button
        type="button"
        onClick={() => toggleFamily(family.id)}
        aria-expanded={expanded}
        aria-label={`${expanded ? "כווץ" : "הרחב"} ${family.name}`}
        className="group flex shrink-0 items-center rounded-md py-1 text-start"
      >
        {/* The gutter. Fixed at NAME_GUTTER so the name after it starts on the
            same edge as every variety name in this column; its contents come
            to 56px (chevron, gap, photo), which leaves the remaining 8px as
            the gap before the name. */}
        <span className={`flex ${NAME_GUTTER} shrink-0 items-center gap-2`}>
          <Icon
            name="chevronDown"
            className={`h-4 w-4 shrink-0 transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
              expanded ? "rotate-180 text-accent" : "text-ink-muted group-hover:text-accent"
            }`}
          />
          <ProductThumbnail
            imageUrl={isEditing ? familyForm.imageUrl : family.image_url}
            size="sm"
          />
        </span>
        {/* A shade larger than a row's own text: this is a section title, and
            the band it sits on reads as a section, so the name should lead it
            rather than match the varieties listed underneath. */}
        {!isEditing && (
          <span className="truncate text-[0.9375rem] font-semibold text-ink">{family.name}</span>
        )}
      </button>
    );

    // Editing falls back to one full-width band rather than the column grid
    // the read state uses. The image-URL field is the reason: it needs ~14rem
    // to show a URL at all, against a `גודל` column that is barely 4rem, so
    // sitting it in a cell would re-measure every column in the table and
    // shove the variety rows sideways on each keystroke. `sticky start-0`
    // keeps the form parked at the frozen edge while the table scrolls under
    // it; `px-4` matches the padding a row's own cells carry (table.tsx), so
    // the controls stay in line with the varieties' edit/delete.
    if (isEditing) {
      return {
        kind: "band",
        content: (
          <div className="sticky start-0 flex w-fit max-w-full items-center gap-2.5 px-4 py-2.5">
            <RowIconButton
              icon="checkCircle"
              label="שמור משפחה"
              tone="accent"
              onClick={handleSaveFamily}
              disabled={savingFamily || !familyDirty || familyForm.name.trim() === ""}
            />
            <RowIconButton
              icon="close"
              label="ביטול עריכת משפחה"
              tone="neutral"
              onClick={handleCancelFamily}
              disabled={savingFamily}
            />
            {toggle}
            <input
              aria-label="שם המשפחה"
              autoFocus
              required
              placeholder={isDraft ? "שם המשפחה" : undefined}
              className={`${inputClassName} w-40`}
              value={familyForm.name}
              onChange={(event) =>
                setFamilyForm((current) => ({ ...current, name: event.target.value }))
              }
            />
            <input
              aria-label="קטגוריית המשפחה"
              placeholder="קטגוריה"
              className={`${inputClassName} w-32`}
              value={familyForm.category}
              onChange={(event) =>
                setFamilyForm((current) => ({ ...current, category: event.target.value }))
              }
            />
            <input
              type="url"
              dir="ltr"
              aria-label="קישור לתמונת המשפחה"
              placeholder="https://…"
              className={`${inputClassName} w-56`}
              value={familyForm.imageUrl}
              onChange={(event) =>
                setFamilyForm((current) => ({ ...current, imageUrl: event.target.value }))
              }
            />
          </div>
        ),
      };
    }

    // Reading: the family's own fields go in the very columns its varieties
    // use, so the one header row stands for both levels — name under
    // "זן / משפחה", category under "משפחה / קטגוריה", the variety count under
    // "גודל / מספר זנים". The family name no longer stays frozen at the start
    // edge as it did when this was a band, and doesn't need to: every variety
    // row carries its family in its own column, which is the redundancy that
    // now earns its keep.
    return {
      kind: "cells",
      actions: (
        <div className="flex items-center gap-1.5">
          {/* Deliberately not disabled for a family that still holds
              varieties: the button opens a dialog that explains WHY it can't
              go (and offers no delete), which teaches the rule. A greyed-out
              trash teaches nothing, and its `title` tooltip never fires on a
              disabled control. */}
          <RowIconButton
            icon="trash"
            label="מחק משפחה"
            tone="danger"
            onClick={() => setDeleteFamilyTargetId(family.id)}
            disabled={locked}
          />
          <RowIconButton
            icon="pencil"
            label="ערוך משפחה"
            tone="neutral"
            onClick={() => handleEditFamily(family)}
            disabled={locked}
          />
        </div>
      ),
      cells: {
        name: toggle,
        family: family.category ? <StatusPill tone="neutral">{family.category}</StatusPill> : null,
        sizes: (
          <span className="whitespace-nowrap text-xs font-semibold text-ink-subtle">
            {varietyCountLabel(varietyCount)}
          </span>
        ),
      },
    };
  }

  return (
    <>
      <PageHeader
        title="מוצרים"
        subtitle="הקטלוג לפי משפחות — לחיצה על משפחה פותחת את הזנים שלה. ניתן לערוך משפחה וזן כאחד."
      />
      <RecordTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        searchText={(row) => `${row.name} ${familyById.get(row.family_id)?.name ?? ""}`}
        editingId={tableEditingId}
        savingEdit={saving}
        dirtyEdit={dirty}
        onEdit={handleEditRow}
        onSaveEdit={handleSave}
        onCancelEdit={editingFamilyId ? handleCancelFamily : handleCancel}
        onDelete={(row) => setDeleteTargetId(row.id)}
        // No `onAdd`: a variety is created from the "זן חדש" row inside an
        // open family, never from the toolbar. A variety cannot exist without
        // a family — product_varieties.family_id is a NOT NULL foreign key,
        // and saveProductInputSchema requires a uuid — so a toolbar "new
        // product" had no family to name and papered over it by silently
        // picking whichever family happened to sort first, leaving the user
        // to correct it in a dropdown. With no families at all it produced a
        // draft that could never be saved and rendered outside every group.
        // Adding from inside a family states the family by construction.
        //
        // The cost, accepted: with every family collapsed (the state the
        // screen opens in) there is no add control on screen until a family
        // is opened. That matches the screen's own premise — the subtitle
        // already says a family opens onto its varieties — and creating a
        // FAMILY, which genuinely has no parent to sit inside, keeps its
        // toolbar button below.
        toolbarExtra={
          <Button
            type="button"
            variant="secondary"
            onClick={handleNewFamily}
            disabled={tableEditingId !== null}
          >
            <Icon name="plusCircle" className="h-4 w-4" />
            משפחה חדשה
          </Button>
        }
        grouping={{
          groups,
          // The first row inside an opened family: adding a variety here
          // carries the family with it, so the משפחה dropdown on the draft
          // comes up already answered instead of asking the user to name a
          // family they just pointed at.
          renderAddRow: (group) => ({
            kind: "cells",
            actions: null,
            cells: {
              name: (
                <button
                  type="button"
                  onClick={() => handleNewInFamily(group.id)}
                  // One of these exists per open family, so the visible "זן
                  // חדש" alone would name several buttons identically. The
                  // family name is appended rather than substituted, so the
                  // accessible name still starts with the text on screen.
                  aria-label={`זן חדש ${familyById.get(group.id)?.name ?? ""}`.trim()}
                  className="group/add flex items-center text-start"
                >
                  {/* The plus rides in the same gutter the family's chevron
                      and photo use, so the label beside it lines up with
                      every variety name in the column and the row reads as
                      the first entry in the list rather than a banner over
                      it. */}
                  <span className={`flex ${NAME_GUTTER} shrink-0 items-center`}>
                    <Icon
                      name="plusCircle"
                      className="h-4 w-4 text-ink-subtle transition-colors duration-150 group-hover/add:text-accent"
                    />
                  </span>
                  <span className="text-sm font-medium text-ink-muted transition-colors duration-150 group-hover/add:text-accent">
                    זן חדש
                  </span>
                </button>
              ),
            },
          }),
          // The row being edited is grouped by the family it will be SAVED
          // to, not the one it currently belongs to — so both a draft row
          // and a variety being moved between families appear under the
          // family their dropdown names, the moment it is chosen.
          getGroupId: (row) => (row.id === editingId ? form.familyId : row.family_id),
          expandedIds: expandedFamilyIds,
        }}
        loading={productsQuery.isLoading || capsQuery.isLoading || familiesQuery.isLoading}
        searchPlaceholder="חיפוש מוצר, זן או משפחה"
        emptyLabel="אין מוצרים עדיין."
      />

      <Dialog
        open={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        title="מחיקת מוצר"
      >
        <p className="mb-4 text-sm">
          האם למחוק את המוצר &quot;
          {deleteTarget ? formatVarietyName(deleteTarget.name, deleteTarget.sizes) : ""}&quot;?
          פעולה זו אינה הפיכה.
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

      {/* Deleting a family is blocked while it still holds varieties —
          product_varieties.family_id is a NOT NULL foreign key with no
          cascade (product-variety.ts), so the database would refuse the
          delete anyway. Refusing it HERE, with the count and the reason,
          turns an opaque 23503 error toast into an instruction; and the
          alternative the FK rules out — deleting a family and silently
          taking its varieties with it — would erase catalog items that
          growers' picks and customers' orders still reference. */}
      <Dialog
        open={deleteFamilyTargetId !== null}
        onClose={() => setDeleteFamilyTargetId(null)}
        title="מחיקת משפחה"
      >
        {deleteFamilyVarietyCount > 0 ? (
          <p className="mb-4 text-sm">
            לא ניתן למחוק את המשפחה &quot;{deleteFamilyTarget?.name}&quot; — יש בה{" "}
            {varietyCountLabel(deleteFamilyVarietyCount)}. יש למחוק אותם, או להעביר אותם למשפחה
            אחרת, ואז למחוק את המשפחה.
          </p>
        ) : (
          <p className="mb-4 text-sm">
            האם למחוק את המשפחה &quot;{deleteFamilyTarget?.name}&quot;? פעולה זו אינה הפיכה.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteFamilyTargetId(null)}>
            {deleteFamilyVarietyCount > 0 ? "סגור" : "ביטול"}
          </Button>
          {deleteFamilyVarietyCount === 0 && (
            <Button
              variant="danger"
              onClick={() => deleteFamilyMutation.mutate()}
              disabled={deleteFamilyMutation.isPending}
            >
              {deleteFamilyMutation.isPending ? "מוחק…" : "מחק"}
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
