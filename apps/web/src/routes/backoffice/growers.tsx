import { saveGrowerInputSchema, toSaveGrowerRpcArgs } from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { ActionBar } from "@/components/reference-data/action-bar";
import { CheckboxList } from "@/components/reference-data/checkbox-list";
import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { ListDetailLayout } from "@/components/reference-data/list-detail-layout";
import { RecordList } from "@/components/reference-data/record-list";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { FormSection, StatusPill } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

interface GrowerCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  default_pickup_time: string | null;
  whatsapp_group_id: string | null;
  transporter_company_id: string | null;
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
}

const BLANK_FORM: FormState = {
  name: "",
  status: "active",
  defaultPickupTime: "",
  whatsappGroupId: "",
  productVarietyIds: new Set(),
  transporterCompanyId: "",
};

function toFormState(row: GrowerCompany, productVarietyIds: string[]): FormState {
  return {
    name: row.name,
    status: row.status,
    defaultPickupTime: row.default_pickup_time ?? "",
    whatsappGroupId: row.whatsapp_group_id ?? "",
    productVarietyIds: new Set(productVarietyIds),
    transporterCompanyId: row.transporter_company_id ?? "",
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const growersQuery = useQuery({
    queryKey: ["reference-data", "growers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, status, default_pickup_time, whatsapp_group_id, transporter_company_id")
        .eq("type", "grower")
        .order("name");
      if (error) throw error;
      return data as GrowerCompany[];
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

  const catalogQuery = useQuery({
    queryKey: ["reference-data", "product-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_varieties")
        .select("id, name, product_families(name)")
        .order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string; product_families: { name: string } | null }>;
    },
  });

  const selectionQuery = useQuery({
    queryKey: ["reference-data", "grower-products", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grower_products")
        .select("product_variety_id")
        .eq("company_id", selectedId!);
      if (error) throw error;
      return data.map((row) => row.product_variety_id);
    },
  });

  const selected = growersQuery.data?.find((row) => row.id === selectedId) ?? null;

  // "לא פעיל" becomes a trailing pill rather than a parenthetical glued to
  // the name, so an inactive record is scannable down the column instead of
  // hiding at the end of a line that may already be truncated.
  const listItems = useMemo(
    () =>
      (growersQuery.data ?? []).map((row) => ({
        id: row.id,
        label: row.name,
        badge: row.status === "inactive" ? "לא פעיל" : null,
      })),
    [growersQuery.data],
  );

  useEffect(() => {
    if (!editing && selected && selectionQuery.data) {
      setForm(toFormState(selected, selectionQuery.data));
    }
  }, [selected, selectionQuery.data, editing]);

  const catalogOptions = useMemo(
    () =>
      (catalogQuery.data ?? []).map((product) => ({
        id: product.id,
        label: product.product_families?.name
          ? `${product.product_families.name} — ${product.name}`
          : product.name,
      })),
    [catalogQuery.data],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = saveGrowerInputSchema.parse({
        id: selectedId,
        name: form.name,
        status: form.status,
        defaultPickupTime: form.defaultPickupTime || null,
        whatsappGroupId: form.whatsappGroupId || null,
        productVarietyIds: [...form.productVarietyIds],
        transporterCompanyId: form.transporterCompanyId || null,
      });
      const { data, error } = await supabase.rpc("save_grower", toSaveGrowerRpcArgs(input));
      if (error) throw error;
      return data as GrowerCompany;
    },
    onSuccess: (row) => {
      showToast("הנתונים נשמרו.", "success");
      setEditing(false);
      setSelectedId(row.id);
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "growers"] });
      void queryClient.invalidateQueries({
        queryKey: ["reference-data", "grower-products", row.id],
      });
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
      showToast("המגדל נמחק.", "success");
      setSelectedId(null);
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "growers"] });
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
    if (selected && selectionQuery.data) {
      setForm(toFormState(selected, selectionQuery.data));
    } else {
      setForm(BLANK_FORM);
    }
    setEditing(false);
  }

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

  return (
    <>
      <ListDetailLayout
        header={<PageHeader title="מגדלים" subtitle="חברות מגדלים והמוצרים שבעונה אצל כל אחת." />}
        list={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <Button type="button" onClick={handleNew}>
              מגדל חדש
            </Button>
            <RecordList
              icon="sprout"
              items={listItems}
              selectedId={selectedId}
              onSelect={handleSelect}
              loading={growersQuery.isLoading}
              searchPlaceholder="חיפוש מגדל"
              emptyLabel="אין מגדלים עדיין."
            />
          </div>
        }
        detail={
          selectedId === null && !editing ? (
            <EmptyState
              icon="sprout"
              title="לא נבחר מגדל"
              hint="בחר מגדל מהרשימה כדי לערוך את פרטיו, או צור מגדל חדש."
              action={
                <Button type="button" onClick={handleNew}>
                  מגדל חדש
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-6">
              {/* Identity strip, so the pane states which grower is open
                  rather than making the user read it back out of the first
                  input. `selectedId` is null while creating a new record, so
                  the heading falls back to the draft name. */}
              <div className="flex items-center gap-3.5 border-b border-border pb-5">
                <span
                  aria-hidden
                  className="font-display flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl text-accent ring-1 ring-inset ring-accent/25"
                >
                  {form.name.trim().charAt(0) || "+"}
                </span>
                <h2 className="font-display min-w-0 flex-1 truncate text-xl text-ink">
                  {form.name || "מגדל חדש"}
                </h2>
                <StatusPill tone={form.status === "active" ? "accent" : "neutral"} dot>
                  {form.status === "active" ? "פעיל" : "לא פעיל"}
                </StatusPill>
              </div>

              <FormSection title="פרטי מגדל" columns={2}>
                <FormField label="שם" htmlFor="grower-name">
                  <input
                    id="grower-name"
                    required
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </FormField>

                <FormField label="סטטוס" htmlFor="grower-status">
                  <select
                    id="grower-status"
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

              <FormSection title="לוגיסטיקה ותקשורת" columns={2}>
                <FormField label="שעת איסוף ברירת מחדל" htmlFor="grower-pickup">
                  <input
                    id="grower-pickup"
                    type="time"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.defaultPickupTime}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, defaultPickupTime: event.target.value }))
                    }
                  />
                </FormField>

                <FormField label="מוביל" htmlFor="grower-transporter">
                  <select
                    id="grower-transporter"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.transporterCompanyId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        transporterCompanyId: event.target.value,
                      }))
                    }
                  >
                    <option value="">— ללא —</option>
                    {transportersQuery.data?.map((transporter) => (
                      <option key={transporter.id} value={transporter.id}>
                        {transporter.name}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="קבוצת WhatsApp" htmlFor="grower-whatsapp">
                  <input
                    id="grower-whatsapp"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.whatsappGroupId}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, whatsappGroupId: event.target.value }))
                    }
                  />
                </FormField>
              </FormSection>

              <FormSection
                title="מוצרים בעונה"
                hint="הזנים שהמגדל הזה מספק כרגע. רק הם ייכללו ברשימת הליקוט היומית שלו."
              >
                <CheckboxList
                  options={catalogOptions}
                  selectedIds={form.productVarietyIds}
                  onToggle={toggleProduct}
                  disabled={!editing}
                />
              </FormSection>

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
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="מחיקת מגדל">
        <p className="mb-4 text-sm">
          האם למחוק את המגדל &quot;{selected?.name}&quot;? פעולה זו אינה הפיכה.
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
