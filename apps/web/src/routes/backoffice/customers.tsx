import { saveCustomerInputSchema, toSaveCustomerRpcArgs } from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { checkboxClassName, inputClassName } from "@/components/reference-data/form-field";
import { RecordTable, type RecordTableColumn } from "@/components/reference-data/record-table";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { hasChanges } from "@/lib/has-changes";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";

interface CustomerCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  can_see_product_prices: boolean | null;
  whatsapp_group_id: string | null;
  created_at: string;
}

interface FormState {
  name: string;
  status: "active" | "inactive";
  canSeeProductPrices: boolean;
  whatsappGroupId: string;
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
  canSeeProductPrices: false,
  whatsappGroupId: "",
};

// Field values here are never actually read — every column has a
// `renderEdit` for the draft row, so nothing falls back to `render(row)`.
// Only `id` matters (for keying and for RecordTable's search-bypass).
function blankRow(): CustomerCompany {
  return {
    id: NEW_ROW_ID,
    name: "",
    status: "active",
    can_see_product_prices: false,
    whatsapp_group_id: null,
    created_at: "",
  };
}

function toFormState(row: CustomerCompany): FormState {
  return {
    name: row.name,
    status: row.status,
    canSeeProductPrices: row.can_see_product_prices ?? false,
    whatsappGroupId: row.whatsapp_group_id ?? "",
  };
}

// The Customers management screen (PRD: "Customer companies"). `save_customer`
// is a single-row save — still an RPC, not a plain `.update()`, for the
// same reason every screen in this module goes through one: one call site
// for the backoffice-only check, and a consistent client pattern across
// all five screens (see packages/db/migrations/0007).
export default function CustomersPage() {
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

  const customersQueryKey = ["reference-data", "customers"] as const;

  const customersQuery = useQuery({
    queryKey: customersQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, status, can_see_product_prices, whatsapp_group_id, created_at")
        .eq("type", "customer")
        .order("name");
      if (error) throw error;
      return data as CustomerCompany[];
    },
  });

  const editingRowId = editingId === NEW_ROW_ID ? null : editingId;
  const selected = customersQuery.data?.find((row) => row.id === editingRowId) ?? null;
  const deleteTarget = customersQuery.data?.find((row) => row.id === deleteTargetId) ?? null;

  const saveOptimistic = optimisticUpdate<CustomerCompany[], void>(
    queryClient,
    customersQueryKey,
    (rows) =>
      rows?.map((row) =>
        row.id === editingRowId
          ? {
              ...row,
              name: form.name,
              status: form.status,
              can_see_product_prices: form.canSeeProductPrices,
              whatsapp_group_id: form.whatsappGroupId || null,
            }
          : row,
      ),
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = saveCustomerInputSchema.parse({
        id: editingRowId,
        name: form.name,
        status: form.status,
        canSeeProductPrices: form.canSeeProductPrices,
        whatsappGroupId: form.whatsappGroupId || null,
      });
      const { data, error } = await supabase.rpc("save_customer", toSaveCustomerRpcArgs(input));
      if (error) throw error;
      return data as CustomerCompany;
    },
    onMutate: saveOptimistic.onMutate,
    onSuccess: () => {
      showToast("הנתונים נשמרו.", "success");
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: customersQueryKey });
    },
    onError: mergeOnError(saveOptimistic.onError, (error: { message?: string }) => {
      showToast(`השמירה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    }),
  });

  const deleteOptimistic = optimisticUpdate<CustomerCompany[], void>(
    queryClient,
    customersQueryKey,
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
      showToast("הלקוח נמחק.", "success");
      setDeleteTargetId(null);
      void queryClient.invalidateQueries({ queryKey: customersQueryKey });
    },
    onError: mergeOnError(deleteOptimistic.onError, (error: { message?: string }) => {
      showToast(`המחיקה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
      setDeleteTargetId(null);
    }),
  });

  // No second, lazily-fetched query behind this form (unlike growers/products/
  // users), so — unlike those three — the row already fetched is the whole
  // baseline: seeding can happen synchronously in the click handler instead
  // of needing an effect to wait for anything.
  function handleEditRow(row: CustomerCompany) {
    setEditingId(row.id);
    setForm(toFormState(row));
  }

  function handleNew() {
    setEditingId(NEW_ROW_ID);
    setForm(BLANK_FORM);
  }

  function handleCancel() {
    setEditingId(null);
  }

  // What the form would hold with no unsaved edits: this record as the
  // server has it. Used both for "בטל שינויים" and for deciding whether
  // either button has anything to do.
  const baselineForm = selected ? toFormState(selected) : BLANK_FORM;
  const dirty = hasChanges(form, baselineForm);

  function handleSave() {
    setSaving(true);
    saveMutation.mutate(undefined, { onSettled: () => setSaving(false) });
  }

  const columns: RecordTableColumn<CustomerCompany>[] = [
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
        <select
          aria-label="סטטוס"
          className={`${inputClassName} w-28`}
          value={form.status}
          onChange={(event) =>
            setForm((current) => ({ ...current, status: event.target.value as "active" | "inactive" }))
          }
        >
          <option value="active">פעיל</option>
          <option value="inactive">לא פעיל</option>
        </select>
      ),
    },
    {
      key: "prices",
      label: "מציג מחירים בהתראות",
      render: (row) => (row.can_see_product_prices ? "כן" : "לא"),
      renderEdit: () => (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className={checkboxClassName}
            aria-label="מציג מחירים בהתראות"
            checked={form.canSeeProductPrices}
            onChange={(event) =>
              setForm((current) => ({ ...current, canSeeProductPrices: event.target.checked }))
            }
          />
          {form.canSeeProductPrices ? "כן" : "לא"}
        </label>
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
      key: "created",
      label: "נוצר",
      // Server-set, so read-only: no renderEdit.
      render: (row) =>
        row.created_at ? CREATED_AT_FORMAT.format(new Date(row.created_at)) : "—",
    },
  ];

  const rows =
    editingId === NEW_ROW_ID ? [blankRow(), ...(customersQuery.data ?? [])] : (customersQuery.data ?? []);

  return (
    <>
      <PageHeader title="לקוחות" subtitle="חברות לקוחות והגדרת הצגת מחירים לכל אחת." />
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
        addLabel="לקוח חדש"
        loading={customersQuery.isLoading}
        searchPlaceholder="חיפוש לקוח"
        emptyLabel="אין לקוחות עדיין."
      />

      <Dialog open={deleteTargetId !== null} onClose={() => setDeleteTargetId(null)} title="מחיקת לקוח">
        <p className="mb-4 text-sm">
          האם למחוק את הלקוח &quot;{deleteTarget?.name}&quot;? פעולה זו אינה הפיכה.
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
