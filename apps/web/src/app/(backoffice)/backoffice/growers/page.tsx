"use client";

import { saveGrowerInputSchema, toSaveGrowerRpcArgs } from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { ActionBar } from "@/components/reference-data/action-bar";
import { CheckboxList } from "@/components/reference-data/checkbox-list";
import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { ListDetailLayout } from "@/components/reference-data/list-detail-layout";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
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
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface shadow-card">
              {growersQuery.isLoading ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <ul>
                  {growersQuery.data?.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(row.id)}
                        className={`block w-full relative border-b border-border px-4 py-2.5 text-start text-sm transition-colors ${
                          row.id === selectedId
                            ? "bg-accent-soft font-semibold text-accent before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-accent"
                            : "hover:bg-canvas"
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
            <p className="text-sm text-ink-muted">בחר מגדל מהרשימה, או צור מגדל חדש.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <FormField label="שם" htmlFor="grower-name">
                <input
                  id="grower-name"
                  required
                  disabled={!editing}
                  className={inputClassName}
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

              <FormField label="שעת איסוף ברירת מחדל" htmlFor="grower-pickup">
                <input
                  id="grower-pickup"
                  type="time"
                  disabled={!editing}
                  className={inputClassName}
                  value={form.defaultPickupTime}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, defaultPickupTime: event.target.value }))
                  }
                />
              </FormField>

              <FormField label="קבוצת WhatsApp" htmlFor="grower-whatsapp">
                <input
                  id="grower-whatsapp"
                  disabled={!editing}
                  className={inputClassName}
                  value={form.whatsappGroupId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, whatsappGroupId: event.target.value }))
                  }
                />
              </FormField>

              <FormField label="מוביל" htmlFor="grower-transporter">
                <select
                  id="grower-transporter"
                  disabled={!editing}
                  className={inputClassName}
                  value={form.transporterCompanyId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, transporterCompanyId: event.target.value }))
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

              <FormField label="מוצרים בעונה" htmlFor="grower-products">
                <CheckboxList
                  options={catalogOptions}
                  selectedIds={form.productVarietyIds}
                  onToggle={toggleProduct}
                  disabled={!editing}
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
