"use client";

import { saveTransporterInputSchema, toSaveTransporterRpcArgs } from "@ori/domain/reference-data";
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

interface TransporterCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  whatsapp_group_id: string | null;
}

interface FormState {
  name: string;
  status: "active" | "inactive";
  whatsappGroupId: string;
}

const BLANK_FORM: FormState = { name: "", status: "active", whatsappGroupId: "" };

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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const transportersQuery = useQuery({
    queryKey: ["reference-data", "transporters"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, status, whatsapp_group_id")
        .eq("type", "transporter")
        .order("name");
      if (error) throw error;
      return data as TransporterCompany[];
    },
  });

  const selected = transportersQuery.data?.find((row) => row.id === selectedId) ?? null;

  useEffect(() => {
    if (!editing && selected) {
      setForm(toFormState(selected));
    }
  }, [selected, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = saveTransporterInputSchema.parse({
        id: selectedId,
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
    onSuccess: (row) => {
      showToast("הנתונים נשמרו.", "success");
      setEditing(false);
      setSelectedId(row.id);
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "transporters"] });
    },
    onError: (error: { message?: string }) => {
      showToast(`השמירה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) return;
      const { error } = await supabase.from("companies").delete().eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("המוביל נמחק.", "success");
      setSelectedId(null);
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "transporters"] });
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
    setForm(BLANK_FORM);
    setEditing(true);
  }

  function handleDiscard() {
    setForm(selected ? toFormState(selected) : BLANK_FORM);
    setEditing(false);
  }

  function handleSave() {
    setSaving(true);
    saveMutation.mutate(undefined, { onSettled: () => setSaving(false) });
  }

  return (
    <>
      <ListDetailLayout
        header={<PageHeader title="מובילים" subtitle="חברות הובלה — נמען WhatsApp בלבד, ללא התחברות למערכת." />}
        list={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <Button type="button" onClick={handleNew}>
              מוביל חדש
            </Button>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface">
              {transportersQuery.isLoading ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <ul>
                  {transportersQuery.data?.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(row.id)}
                        className={`block w-full border-b border-border px-4 py-3 text-start text-sm hover:bg-canvas ${
                          row.id === selectedId ? "bg-canvas font-medium" : ""
                        }`}
                      >
                        {row.name}
                        {row.status === "inactive" && (
                          <span className="ms-2 text-xs text-ink-muted">(לא פעיל)</span>
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
            <p className="text-sm text-ink-muted">בחר מוביל מהרשימה, או צור מוביל חדש.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <FormField label="שם" htmlFor="transporter-name">
                <input
                  id="transporter-name"
                  required
                  disabled={!editing}
                  className={inputClassName}
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </FormField>

              <FormField label="סטטוס" htmlFor="transporter-status">
                <select
                  id="transporter-status"
                  disabled={!editing}
                  className={inputClassName}
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as "active" | "inactive",
                    }))
                  }
                >
                  <option value="active">פעיל</option>
                  <option value="inactive">לא פעיל</option>
                </select>
              </FormField>

              <FormField label="קבוצת WhatsApp" htmlFor="transporter-whatsapp">
                <input
                  id="transporter-whatsapp"
                  disabled={!editing}
                  className={inputClassName}
                  value={form.whatsappGroupId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, whatsappGroupId: event.target.value }))
                  }
                />
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
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="מחיקת מוביל">
        <p className="mb-4 text-sm">
          האם למחוק את המוביל &quot;{selected?.name}&quot;? פעולה זו אינה הפיכה.
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
