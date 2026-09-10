import { saveCustomerInputSchema, toSaveCustomerRpcArgs } from "@ori/domain/reference-data";
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

interface CustomerCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  can_see_product_prices: boolean | null;
  whatsapp_group_id: string | null;
}

interface FormState {
  name: string;
  status: "active" | "inactive";
  canSeeProductPrices: boolean;
  whatsappGroupId: string;
}

const BLANK_FORM: FormState = {
  name: "",
  status: "active",
  canSeeProductPrices: false,
  whatsappGroupId: "",
};

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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const customersQuery = useQuery({
    queryKey: ["reference-data", "customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, status, can_see_product_prices, whatsapp_group_id")
        .eq("type", "customer")
        .order("name");
      if (error) throw error;
      return data as CustomerCompany[];
    },
  });

  const selected = customersQuery.data?.find((row) => row.id === selectedId) ?? null;

  // "לא פעיל" as a trailing pill rather than a parenthetical glued to the
  // name — scannable down the column instead of hiding at the end of a line
  // that may already be truncated.
  const listItems = useMemo(
    () =>
      (customersQuery.data ?? []).map((row) => ({
        id: row.id,
        label: row.name,
        badge: row.status === "inactive" ? "לא פעיל" : null,
      })),
    [customersQuery.data],
  );

  useEffect(() => {
    if (!editing && selected) {
      setForm(toFormState(selected));
    }
  }, [selected, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = saveCustomerInputSchema.parse({
        id: selectedId,
        name: form.name,
        status: form.status,
        canSeeProductPrices: form.canSeeProductPrices,
        whatsappGroupId: form.whatsappGroupId || null,
      });
      const { data, error } = await supabase.rpc("save_customer", toSaveCustomerRpcArgs(input));
      if (error) throw error;
      return data as CustomerCompany;
    },
    onSuccess: (row) => {
      showToast("הנתונים נשמרו.", "success");
      setEditing(false);
      setSelectedId(row.id);
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "customers"] });
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
      showToast("הלקוח נמחק.", "success");
      setSelectedId(null);
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "customers"] });
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

  // What the form would hold with no unsaved edits: this record as the
  // server has it, or a blank one while creating. Defined once and used for
  // both jobs it has — the values "בטל שינויים" restores, and the values the
  // current form is compared against to decide whether either button has
  // anything to do. Deriving them from one expression is what stops the
  // button from claiming "no changes" while discard would in fact change
  // something.
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
        header={<PageHeader title="לקוחות" subtitle="חברות לקוחות והגדרת הצגת מחירים לכל אחת." />}
        list={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <Button type="button" onClick={handleNew}>
              לקוח חדש
            </Button>
            <RecordList
              icon="briefcase"
              items={listItems}
              selectedId={selectedId}
              onSelect={handleSelect}
              loading={customersQuery.isLoading}
              searchPlaceholder="חיפוש לקוח"
              emptyLabel="אין לקוחות עדיין."
            />
          </div>
        }
        detail={
          selectedId === null && !editing ? (
            <EmptyState
              icon="briefcase"
              title="לא נבחר לקוח"
              hint="בחר לקוח מהרשימה כדי לערוך את פרטיו, או צור לקוח חדש."
              action={
                <Button type="button" onClick={handleNew}>
                  לקוח חדש
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
                  {form.name || "לקוח חדש"}
                </h2>
                <StatusPill tone={form.status === "active" ? "accent" : "neutral"} dot>
                  {form.status === "active" ? "פעיל" : "לא פעיל"}
                </StatusPill>
              </div>

              <FormSection title="פרטי לקוח" columns={2}>
                <FormField label="שם" htmlFor="customer-name">
                  <input
                    id="customer-name"
                    required
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </FormField>

                <FormField label="סטטוס" htmlFor="customer-status">
                  <select
                    id="customer-status"
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
                <FormField label="קבוצת WhatsApp" htmlFor="customer-whatsapp">
                  <input
                    id="customer-whatsapp"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.whatsappGroupId}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, whatsappGroupId: event.target.value }))
                    }
                  />
                </FormField>

                {/* The bare checkbox floating between two labelled fields
                    read as an orphan. Boxed and given the same weight as a
                    field label, it becomes a setting rather than a stray. */}
                <label
                  className={`flex items-start gap-2.5 rounded-lg bg-surface-muted/60 px-3.5 py-3 text-sm ring-1 ring-inset ring-border ${
                    editing ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={!editing}
                    checked={form.canSeeProductPrices}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        canSeeProductPrices: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    <span className="block font-medium text-ink">מציג מחירים בהתראות</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      כשמכובה, הודעות ה-WhatsApp ללקוח זה יישלחו ללא מחירים.
                    </span>
                  </span>
                </label>
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
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="מחיקת לקוח">
        <p className="mb-4 text-sm">
          האם למחוק את הלקוח &quot;{selected?.name}&quot;? פעולה זו אינה הפיכה.
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
