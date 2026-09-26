import { saveGrowerInputSchema, toSaveGrowerRpcArgs } from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { CellChipList } from "@/components/reference-data/cell-popover";
import { ContactPersonEditCell, ContactPersonSummary } from "@/components/reference-data/contact-person-cell";
import { inputClassName } from "@/components/reference-data/form-field";
import { ProductMultiSelectCell } from "@/components/reference-data/product-multi-select-cell";
import { RecordTable, type RecordTableColumn } from "@/components/reference-data/record-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/error-message";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { hasChanges } from "@/lib/has-changes";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";
import { useContactPersonDirectory } from "@/lib/use-contact-person-directory";
import { formatVarietyName } from "@/lib/variety-label";

interface GrowerCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  default_pickup_time: string | null;
  whatsapp_group_id: string | null;
  transporter_company_id: string | null;
  contact_person_id: string | null;
  created_at: string;
}

interface TransporterOption {
  id: string;
  name: string;
}

interface FormState {
  name: string;
  status: "active" | "inactive";
  defaultPickupTime: string;
  whatsappGroupId: string;
  productVarietyIds: Set<string>;
  transporterCompanyId: string;
  contactPersonId: string;
}

// Sentinel row id for a not-yet-created record: the draft row prepended to
// the table while `onAdd` is active, so RecordTable's "is this row being
// edited" logic (which compares ids) needs no separate create/update
// concept of its own.
const NEW_ROW_ID = "__new__";

const CREATED_AT_FORMAT = new Intl.DateTimeFormat("he-IL", { dateStyle: "short" });

const BLANK_FORM: FormState = {
  name: "",
  status: "active",
  defaultPickupTime: "",
  whatsappGroupId: "",
  productVarietyIds: new Set(),
  transporterCompanyId: "",
  contactPersonId: "",
};

function blankRow(): GrowerCompany {
  return {
    id: NEW_ROW_ID,
    name: "",
    status: "active",
    default_pickup_time: null,
    whatsapp_group_id: null,
    transporter_company_id: null,
    contact_person_id: null,
    created_at: "",
  };
}

function toFormState(row: GrowerCompany, productVarietyIds: string[]): FormState {
  return {
    name: row.name,
    status: row.status,
    defaultPickupTime: row.default_pickup_time ?? "",
    whatsappGroupId: row.whatsapp_group_id ?? "",
    productVarietyIds: new Set(productVarietyIds),
    transporterCompanyId: row.transporter_company_id ?? "",
    contactPersonId: row.contact_person_id ?? "",
  };
}

// The Growers management screen (PRD: "Grower companies + their
// products-in-season list"). Every save goes through `save_grower` — one
// RPC call replaces the company row and its whole grower_products
// selection transactionally (R4); a plain `.update()` here would be a
// two-step client-side sequence with the exact partial-failure exposure
// the source app has.
export default function GrowersPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Which row (by id) is being edited inline right now — NEW_ROW_ID for a
  // draft that hasn't been saved yet, an existing row's own id, or null.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  // Separate from `editingId` — deleting a row is still a confirm dialog,
  // not inline, so it needs its own target rather than reusing edit state.
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const growersQueryKey = ["reference-data", "growers"] as const;
  const growerProductsQueryKey = ["reference-data", "grower-products-all"] as const;

  const growersQuery = useQuery({
    queryKey: growersQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select(
          "id, name, status, default_pickup_time, whatsapp_group_id, transporter_company_id, contact_person_id, created_at",
        )
        .eq("type", "grower")
        .order("name");
      if (error) throw error;
      return data as GrowerCompany[];
    },
  });

  const contactDirectory = useContactPersonDirectory();

  // Every grower's in-season selection in ONE read, grouped client-side —
  // not a query per row. The in-season list is a column now, so every
  // visible row needs its own value; per-row queries would mean one request
  // per grower on first paint. Paged (see fetchAllRows) because this table
  // is the one that outgrows PostgREST's row cap.
  const growerProductsQuery = useQuery({
    queryKey: growerProductsQueryKey,
    queryFn: async () => {
      const rows = await fetchAllRows<{ company_id: string; product_variety_id: string }>(
        (from, to) =>
          supabase
            .from("grower_products")
            .select("company_id, product_variety_id")
            .order("company_id")
            .order("product_variety_id")
            .range(from, to),
      );
      const byCompany = new Map<string, string[]>();
      for (const row of rows) {
        const list = byCompany.get(row.company_id);
        if (list) list.push(row.product_variety_id);
        else byCompany.set(row.company_id, [row.product_variety_id]);
      }
      return byCompany;
    },
  });

  // Active transporters only — the "מוביל" dropdown lets a distributor
  // assign the transporter that gets cc'd on this grower's arrangement-
  // finalization message (id 8, packages/db/migrations/0031/0033).
  const transportersQuery = useQuery({
    queryKey: ["reference-data", "transporters-for-grower-assignment"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name")
        .eq("type", "transporter")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as TransporterOption[];
    },
  });
  const transporterNameById = useMemo(
    () => new Map((transportersQuery.data ?? []).map((row) => [row.id, row.name])),
    [transportersQuery.data],
  );

  const catalogQuery = useQuery({
    queryKey: ["reference-data", "product-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_varieties")
        .select("id, name, sizes, product_families(name)")
        .order("name");
      if (error) throw error;
      return data as Array<{
        id: string;
        name: string;
        sizes: string | null;
        product_families: { name: string } | null;
      }>;
    },
  });

  const catalogOptions = useMemo(
    () =>
      (catalogQuery.data ?? []).map((product) => ({
        id: product.id,
        label: product.product_families?.name
          ? `${product.product_families.name} — ${formatVarietyName(product.name, product.sizes)}`
          : formatVarietyName(product.name, product.sizes),
      })),
    [catalogQuery.data],
  );
  const varietyLabelById = useMemo(
    () => new Map(catalogOptions.map((option) => [option.id, option.label])),
    [catalogOptions],
  );

  const editingRowId = editingId !== null && editingId !== NEW_ROW_ID ? editingId : null;
  const selected = growersQuery.data?.find((row) => row.id === editingRowId) ?? null;
  const deleteTarget = growersQuery.data?.find((row) => row.id === deleteTargetId) ?? null;

  // Only patches an existing row — a brand-new grower (still unsaved,
  // editingId === NEW_ROW_ID) stays pessimistic: faking a row for an id the
  // server hasn't issued yet isn't worth the risk for a save that's
  // infrequent to begin with.
  const saveOptimistic = optimisticUpdate<GrowerCompany[], void>(
    queryClient,
    growersQueryKey,
    (rows) =>
      rows?.map((row) =>
        row.id === editingRowId
          ? {
              ...row,
              name: form.name,
              status: form.status,
              default_pickup_time: form.defaultPickupTime || null,
              whatsapp_group_id: form.whatsappGroupId || null,
              transporter_company_id: form.transporterCompanyId || null,
              contact_person_id: form.contactPersonId || null,
            }
          : row,
      ),
  );

  // The in-season list lives in its own query, so its optimistic patch is
  // its own too — without it, the row's "מוצרים בעונה" cell would snap back
  // to the pre-edit chips until the refetch lands.
  const saveProductsOptimistic = optimisticUpdate<Map<string, string[]>, void>(
    queryClient,
    growerProductsQueryKey,
    (byCompany) => {
      if (!byCompany || !editingRowId) return byCompany;
      const next = new Map(byCompany);
      next.set(editingRowId, [...form.productVarietyIds]);
      return next;
    },
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = saveGrowerInputSchema.parse({
        id: editingRowId,
        name: form.name,
        status: form.status,
        defaultPickupTime: form.defaultPickupTime || null,
        whatsappGroupId: form.whatsappGroupId || null,
        productVarietyIds: [...form.productVarietyIds],
        transporterCompanyId: form.transporterCompanyId || null,
        contactPersonId: form.contactPersonId || null,
      });
      const { data, error } = await supabase.rpc("save_grower", toSaveGrowerRpcArgs(input));
      if (error) throw error;
      return data as GrowerCompany;
    },
    onMutate: async (variables) => {
      const rows = await saveOptimistic.onMutate(variables);
      const products = await saveProductsOptimistic.onMutate(variables);
      return { rows, products };
    },
    onSuccess: () => {
      showToast("הנתונים נשמרו.", "success");
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: growersQueryKey });
      void queryClient.invalidateQueries({ queryKey: growerProductsQueryKey });
    },
    onError: (
      error: { message?: string },
      variables,
      context:
        | {
            rows: { previous: GrowerCompany[] | undefined } | undefined;
            products: { previous: Map<string, string[]> | undefined } | undefined;
          }
        | undefined,
    ) => {
      saveOptimistic.onError(error, variables, context?.rows);
      saveProductsOptimistic.onError(error, variables, context?.products);
      showToast(`השמירה נכשלה: ${errorMessage(error)}`, "error");
    },
  });

  const deleteOptimistic = optimisticUpdate<GrowerCompany[], void>(
    queryClient,
    growersQueryKey,
    (rows) => rows?.filter((row) => row.id !== deleteTargetId),
  );

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTargetId) return;
      const { error } = await supabase.from("companies").delete().eq("id", deleteTargetId);
      if (error) throw error;
    },
    onMutate: deleteOptimistic.onMutate,
    onSuccess: () => {
      showToast("המגדל נמחק.", "success");
      setDeleteTargetId(null);
      void queryClient.invalidateQueries({ queryKey: growersQueryKey });
    },
    onError: mergeOnError(deleteOptimistic.onError, (error: { message?: string }) => {
      showToast(`המחיקה נכשלה: ${errorMessage(error)}`, "error");
      setDeleteTargetId(null);
    }),
  });

  // Seeded synchronously from data the table already has — the in-season
  // list is loaded up front for the column, not lazily on click, so there's
  // no window where the form is rendered but not yet filled (which is what
  // used to let a fast edit get overwritten by a late-arriving seed).
  function handleEditRow(row: GrowerCompany) {
    setEditingId(row.id);
    setForm(toFormState(row, growerProductsQuery.data?.get(row.id) ?? []));
  }

  function handleNew() {
    setEditingId(NEW_ROW_ID);
    setForm(BLANK_FORM);
  }

  function handleCancel() {
    setEditingId(null);
  }

  // What the form would hold with no unsaved edits — decides whether the
  // save button has anything to do. Computed from the live query data on
  // every render rather than frozen at seed time, so it always reflects the
  // actual current server state.
  const baselineForm = selected
    ? toFormState(selected, growerProductsQuery.data?.get(selected.id) ?? [])
    : BLANK_FORM;
  const dirty = hasChanges(form, baselineForm);

  function toggleProduct(id: string) {
    setForm((current) => {
      const next = new Set(current.productVarietyIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, productVarietyIds: next };
    });
  }

  function handleSave() {
    setSaving(true);
    saveMutation.mutate(undefined, { onSettled: () => setSaving(false) });
  }

  const columns: RecordTableColumn<GrowerCompany>[] = [
    {
      key: "name",
      label: "שם",
      render: (row) => <span className="font-medium text-ink">{row.name}</span>,
      renderEdit: () => (
        <input
          aria-label="שם"
          autoFocus
          required
          className={`${inputClassName} w-full min-w-[10rem]`}
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        />
      ),
    },
    {
      key: "status",
      label: "סטטוס",
      render: (row) => (
        <StatusPill tone={row.status === "active" ? "accent" : "neutral"} dot>
          {row.status === "active" ? "פעיל" : "לא פעיל"}
        </StatusPill>
      ),
      renderEdit: () => (
        <Select
          aria-label="סטטוס"
          className="w-28"
          value={form.status}
          onChange={(next) =>
            setForm((current) => ({ ...current, status: next as "active" | "inactive" }))
          }
          options={[
            { value: "active", label: "פעיל" },
            { value: "inactive", label: "לא פעיל" },
          ]}
        />
      ),
    },
    {
      key: "pickup",
      label: "שעת איסוף",
      render: (row) => row.default_pickup_time || "—",
      renderEdit: () => (
        <input
          type="time"
          aria-label="שעת איסוף ברירת מחדל"
          className={`${inputClassName} w-32`}
          value={form.defaultPickupTime}
          onChange={(event) =>
            setForm((current) => ({ ...current, defaultPickupTime: event.target.value }))
          }
        />
      ),
    },
    {
      key: "transporter",
      label: "מוביל",
      render: (row) =>
        row.transporter_company_id
          ? (transporterNameById.get(row.transporter_company_id) ?? "—")
          : "—",
      renderEdit: () => (
        <Select
          aria-label="מוביל"
          className="w-full min-w-[9rem]"
          value={form.transporterCompanyId}
          onChange={(next) =>
            setForm((current) => ({ ...current, transporterCompanyId: next }))
          }
          options={[
            { value: "", label: "— ללא —" },
            ...(transportersQuery.data?.map((transporter) => ({
              value: transporter.id,
              label: transporter.name,
            })) ?? []),
          ]}
        />
      ),
    },
    {
      key: "whatsapp",
      label: "קבוצת WhatsApp",
      render: (row) => row.whatsapp_group_id || "—",
      renderEdit: () => (
        <input
          aria-label="קבוצת WhatsApp"
          className={`${inputClassName} w-full min-w-[10rem]`}
          value={form.whatsappGroupId}
          onChange={(event) =>
            setForm((current) => ({ ...current, whatsappGroupId: event.target.value }))
          }
        />
      ),
    },
    {
      key: "contactPerson",
      label: "איש קשר",
      render: (row) => (
        <ContactPersonSummary
          option={row.contact_person_id ? contactDirectory.optionById.get(row.contact_person_id) ?? null : null}
        />
      ),
      renderEdit: () => (
        <ContactPersonEditCell
          options={contactDirectory.options}
          selectedId={form.contactPersonId || null}
          onSelect={(id) => setForm((current) => ({ ...current, contactPersonId: id ?? "" }))}
        />
      ),
    },
    {
      key: "inSeason",
      label: "מוצרים בעונה",
      render: (row) => (
        <CellChipList
          items={(growerProductsQuery.data?.get(row.id) ?? []).map(
            (id) => varietyLabelById.get(id) ?? id,
          )}
          emptyLabel="אין מוצרים בעונה"
        />
      ),
      renderEdit: () => (
        <ProductMultiSelectCell
          label="מוצרים בעונה"
          options={catalogOptions}
          selectedIds={form.productVarietyIds}
          onToggle={toggleProduct}
        />
      ),
    },
    {
      key: "created",
      label: "נוצר",
      // Server-set, so read-only: no renderEdit.
      render: (row) =>
        row.created_at ? CREATED_AT_FORMAT.format(new Date(row.created_at)) : "—",
    },
  ];

  const rows =
    editingId === NEW_ROW_ID ? [blankRow(), ...(growersQuery.data ?? [])] : (growersQuery.data ?? []);

  return (
    <>
      <PageHeader title="מגדלים" subtitle="חברות מגדלים והמוצרים שבעונה אצל כל אחת." />
      <RecordTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        searchText={(row) => `${row.name} ${row.whatsapp_group_id ?? ""}`}
        editingId={editingId}
        savingEdit={saving}
        dirtyEdit={dirty}
        onEdit={handleEditRow}
        onSaveEdit={handleSave}
        onCancelEdit={handleCancel}
        onDelete={(row) => setDeleteTargetId(row.id)}
        onAdd={handleNew}
        addLabel="מגדל חדש"
        // Waits for the in-season lists and the contact-person directory
        // too: both are columns now, and a table that paints rows before
        // they arrive would show every grower as having nothing in season
        // (or an unresolved contact) for a moment.
        loading={
          growersQuery.isLoading || growerProductsQuery.isLoading || contactDirectory.isLoading
        }
        // Same reasoning as `loading` above, for the error path.
        loadError={
          (growersQuery.isError && !growersQuery.data) ||
          (growerProductsQuery.isError && !growerProductsQuery.data) ||
          (contactDirectory.isError && contactDirectory.options.length === 0)
            ? {
                what: "רשימת המגדלים",
                onRetry: () => {
                  void growersQuery.refetch();
                  void growerProductsQuery.refetch();
                  contactDirectory.refetch();
                },
                retrying:
                  growersQuery.isFetching || growerProductsQuery.isFetching || contactDirectory.isFetching,
              }
            : null
        }
        searchPlaceholder="חיפוש מגדל"
        emptyLabel="אין מגדלים עדיין."
      />

      <Dialog open={deleteTargetId !== null} onClose={() => setDeleteTargetId(null)} title="מחיקת מגדל">
        <p className="mb-4 text-sm">
          האם למחוק את המגדל &quot;{deleteTarget?.name}&quot;? פעולה זו אינה הפיכה.
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
