import { saveTransporterInputSchema, toSaveTransporterRpcArgs } from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";
import { RecordTable, type RecordTableColumn } from "@/components/reference-data/record-table";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { hasChanges } from "@/lib/has-changes";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";

interface TransporterCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  whatsapp_group_id: string | null;
  created_at: string;
}

interface FormState {
  name: string;
  status: "active" | "inactive";
  whatsappGroupId: string;
}

// Sentinel row id for a not-yet-created record: the draft row prepended to
// the table while `onAdd` is active, so RecordTable's "is this row being
// edited" logic (which compares ids) needs no separate create/update
// concept of its own.
const NEW_ROW_ID = "__new__";

const CREATED_AT_FORMAT = new Intl.DateTimeFormat("he-IL", { dateStyle: "short" });

const BLANK_FORM: FormState = { name: "", status: "active", whatsappGroupId: "" };

function blankRow(): TransporterCompany {
  return { id: NEW_ROW_ID, name: "", status: "active", whatsapp_group_id: null, created_at: "" };
}

function toFormState(row: TransporterCompany): FormState {
  return { name: row.name, status: row.status, whatsappGroupId: row.whatsapp_group_id ?? "" };
}

// The Transporters management screen — directory only. Per the PRD, a
// Transporter is a WhatsApp-only recipient with no in-app login of its
// own (see docs/SCHEMA_DECISIONS.md's user_role enum note), so this
// screen's record is just enough to address outbound dispatch, not an
// account.
export default function TransportersPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  // Separate from `editingId` — deleting a row is still a confirm dialog,
  // not inline, so it needs its own target rather than reusing edit state.
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const transportersQueryKey = ["reference-data", "transporters"] as const;

  const transportersQuery = useQuery({
    queryKey: transportersQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, status, whatsapp_group_id, created_at")
        .eq("type", "transporter")
        .order("name");
      if (error) throw error;
      return data as TransporterCompany[];
    },
  });

  const editingRowId = editingId !== null && editingId !== NEW_ROW_ID ? editingId : null;
  const selected = transportersQuery.data?.find((row) => row.id === editingRowId) ?? null;
  const deleteTarget = transportersQuery.data?.find((row) => row.id === deleteTargetId) ?? null;

  const saveOptimistic = optimisticUpdate<TransporterCompany[], void>(
    queryClient,
    transportersQueryKey,
    (rows) =>
      rows?.map((row) =>
        row.id === editingRowId
          ? {
              ...row,
              name: form.name,
              status: form.status,
              whatsapp_group_id: form.whatsappGroupId || null,
            }
          : row,
      ),
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = saveTransporterInputSchema.parse({
        id: editingRowId,
        name: form.name,
        status: form.status,
        whatsappGroupId: form.whatsappGroupId || null,
      });
      const { data, error } = await supabase.rpc(
        "save_transporter",
        toSaveTransporterRpcArgs(input),
      );
      if (error) throw error;
      return data as TransporterCompany;
    },
    onMutate: saveOptimistic.onMutate,
    onSuccess: () => {
      showToast("הנתונים נשמרו.", "success");
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: transportersQueryKey });
    },
    onError: mergeOnError(saveOptimistic.onError, (error: { message?: string }) => {
      showToast(`השמירה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    }),
  });

  const deleteOptimistic = optimisticUpdate<TransporterCompany[], void>(
    queryClient,
    transportersQueryKey,
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
      showToast("המוביל נמחק.", "success");
      setDeleteTargetId(null);
      void queryClient.invalidateQueries({ queryKey: transportersQueryKey });
    },
    onError: mergeOnError(deleteOptimistic.onError, (error: { message?: string }) => {
      showToast(`המחיקה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
      setDeleteTargetId(null);
    }),
  });

  function handleEditRow(row: TransporterCompany) {
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
  // server has it. Decides whether the save button has anything to do.
  const baselineForm = selected ? toFormState(selected) : BLANK_FORM;
  const dirty = hasChanges(form, baselineForm);

  function handleSave() {
    setSaving(true);
    saveMutation.mutate(undefined, { onSettled: () => setSaving(false) });
  }

  const columns: RecordTableColumn<TransporterCompany>[] = [
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
    editingId === NEW_ROW_ID
      ? [blankRow(), ...(transportersQuery.data ?? [])]
      : (transportersQuery.data ?? []);

  return (
    <>
      <PageHeader title="מובילים" subtitle="חברות הובלה — נמען WhatsApp בלבד, ללא התחברות למערכת." />
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
        addLabel="מוביל חדש"
        loading={transportersQuery.isLoading}
        searchPlaceholder="חיפוש מוביל"
        emptyLabel="אין מובילים עדיין."
      />

      <Dialog open={deleteTargetId !== null} onClose={() => setDeleteTargetId(null)} title="מחיקת מוביל">
        <p className="mb-4 text-sm">
          האם למחוק את המוביל &quot;{deleteTarget?.name}&quot;? פעולה זו אינה הפיכה.
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
