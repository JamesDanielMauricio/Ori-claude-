import { saveTransporterInputSchema, toSaveTransporterRpcArgs } from "@ori/domain/reference-data";
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

  // "לא פעיל" as a trailing pill rather than a parenthetical glued to the
  // name — scannable down the column instead of hiding at the end of a line
  // that may already be truncated.
  const listItems = useMemo(
    () =>
      (transportersQuery.data ?? []).map((row) => ({
        id: row.id,
        label: row.name,
        badge: row.status === "inactive" ? "לא פעיל" : null,
      })),
    [transportersQuery.data],
  );

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

  // The values with no unsaved edits — both what "בטל שינויים" restores and
  // what the live form is compared against. See customers.tsx for why these
  // are one expression rather than two.
  const baselineForm = selected ? toFormState(selected) : BLANK_FORM;
  const dirty = hasChanges(form, baselineForm);

  function handleDiscard() {
    setForm(baselineForm);
    setEditing(false);
  }

  function handleSave() {
    setSaving(true);
    saveMutation.mutate(undefined, { onSettled: () => setSaving(false) });
  }

  return (
    <>
      <ListDetailLayout
        header={
          <PageHeader
            title="מובילים"
            subtitle="חברות הובלה — נמען WhatsApp בלבד, ללא התחברות למערכת."
          />
        }
        list={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <Button type="button" onClick={handleNew}>
              מוביל חדש
            </Button>
            <RecordList
              icon="truck"
              items={listItems}
              selectedId={selectedId}
              onSelect={handleSelect}
              loading={transportersQuery.isLoading}
              searchPlaceholder="חיפוש מוביל"
              emptyLabel="אין מובילים עדיין."
            />
          </div>
        }
        detail={
          selectedId === null && !editing ? (
            <EmptyState
              icon="truck"
              title="לא נבחר מוביל"
              hint="בחר מוביל מהרשימה כדי לערוך את פרטיו, או צור מוביל חדש."
              action={
                <Button type="button" onClick={handleNew}>
                  מוביל חדש
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
                <h2 className="font-display min-w-0 flex-1 truncate text-xl text-ink">
                  {form.name || "מוביל חדש"}
                </h2>
                <StatusPill tone={form.status === "active" ? "accent" : "neutral"} dot>
                  {form.status === "active" ? "פעיל" : "לא פעיל"}
                </StatusPill>
              </div>

              <FormSection title="פרטי מוביל" columns={2}>
                <FormField label="שם" htmlFor="transporter-name">
                  <input
                    id="transporter-name"
                    required
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
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
                    className={`${inputClassName} w-full`}
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
              </FormSection>

              <FormSection title="התראות WhatsApp">
                <FormField label="קבוצת WhatsApp" htmlFor="transporter-whatsapp">
                  <input
                    id="transporter-whatsapp"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.whatsappGroupId}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, whatsappGroupId: event.target.value }))
                    }
                  />
                </FormField>
              </FormSection>

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
