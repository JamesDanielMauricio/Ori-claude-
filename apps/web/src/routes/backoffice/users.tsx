import { saveUserInputSchema, toSaveUserRpcArgs } from "@ori/domain/reference-data";
import type { UserRole } from "@ori/shared/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ActionBar } from "@/components/reference-data/action-bar";
import { CheckboxList } from "@/components/reference-data/checkbox-list";
import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { ListDetailLayout } from "@/components/reference-data/list-detail-layout";
import { RecordList } from "@/components/reference-data/record-list";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { FormSection, StatusPill } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { trpc } from "@/lib/trpc-client";

interface ProfileRow {
  user_id: string;
  display_name: string;
  role: UserRole;
  company_id: string;
  companies: { name: string } | null;
}

// One place for the role wording, so the list pill and the <select> below
// can never drift apart.
const ROLE_LABEL: Record<UserRole, string> = {
  backoffice: "משרד אחורי",
  grower: "מגדל",
  customer: "לקוח",
};

interface FormState {
  displayName: string;
  role: UserRole;
  companyId: string;
  blockedProductVarietyIds: Set<string>;
}

function toFormState(row: ProfileRow, blocked: string[]): FormState {
  return {
    displayName: row.display_name,
    role: row.role,
    companyId: row.company_id,
    blockedProductVarietyIds: new Set(blocked),
  };
}

// The Users management screen — view/edit + the per-user product
// blacklist. Creation stays the existing bulk-import flow (a `profiles`
// row with no matching `auth.users` identity would be an orphan — see
// packages/domain/src/auth/bulk-create-users.ts); this screen only edits
// an already-provisioned account and deletes one (via the service-role
// Admin API, not a plain RLS-scoped delete — see
// packages/domain/src/auth/delete-user.ts).
export default function UsersPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const usersQuery = useQuery({
    queryKey: ["reference-data", "users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, role, company_id, companies(name)")
        .order("display_name");
      if (error) throw error;
      return data as unknown as ProfileRow[];
    },
  });

  const companiesQuery = useQuery({
    queryKey: ["reference-data", "companies-for-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, type")
        .order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string; type: string }>;
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

  const blockedQuery = useQuery({
    queryKey: ["reference-data", "blocked-products", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profile_blocked_products")
        .select("product_variety_id")
        .eq("user_id", selectedId!);
      if (error) throw error;
      return data.map((row) => row.product_variety_id);
    },
  });

  const selected = usersQuery.data?.find((row) => row.user_id === selectedId) ?? null;

  useEffect(() => {
    if (!editing && selected && blockedQuery.data) {
      setForm(toFormState(selected, blockedQuery.data));
    }
  }, [selected, blockedQuery.data, editing]);

  // Company on its own second line and the role as a trailing pill, rather
  // than everything concatenated into the primary label — that is what
  // rendered rows as "Customer 01(Customer 01)".
  const listItems = useMemo(
    () =>
      (usersQuery.data ?? []).map((row) => ({
        id: row.user_id,
        label: row.display_name,
        meta: row.companies?.name ?? null,
        badge: ROLE_LABEL[row.role],
      })),
    [usersQuery.data],
  );

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
      if (!selectedId || !form) throw new Error("No user selected");
      const input = saveUserInputSchema.parse({
        userId: selectedId,
        displayName: form.displayName,
        role: form.role,
        companyId: form.companyId,
        blockedProductVarietyIds: [...form.blockedProductVarietyIds],
      });
      const { data, error } = await supabase.rpc("save_user", toSaveUserRpcArgs(input));
      if (error) throw error;
      return data as { user_id: string };
    },
    onSuccess: (row) => {
      showToast("הנתונים נשמרו.", "success");
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "users"] });
      void queryClient.invalidateQueries({
        queryKey: ["reference-data", "blocked-products", row.user_id],
      });
    },
    onError: (error: { message?: string }) => {
      showToast(`השמירה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const deleteMutation = trpc.auth.deleteUser.useMutation({
    onSuccess: () => {
      showToast("המשתמש נמחק.", "success");
      setSelectedId(null);
      setForm(null);
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "users"] });
    },
    onError: (error) => {
      showToast(`המחיקה נכשלה: ${error.message}`, "error");
      setDeleteOpen(false);
    },
  });

  function handleSelect(id: string) {
    setSelectedId(id);
    setEditing(false);
  }

  function handleDiscard() {
    if (selected && blockedQuery.data) {
      setForm(toFormState(selected, blockedQuery.data));
    }
    setEditing(false);
  }

  function handleSave() {
    setSaving(true);
    saveMutation.mutate(undefined, { onSettled: () => setSaving(false) });
  }

  function toggleBlocked(id: string) {
    setForm((current) => {
      if (!current) return current;
      const next = new Set(current.blockedProductVarietyIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, blockedProductVarietyIds: next };
    });
  }

  return (
    <>
      <ListDetailLayout
        header={
          <PageHeader title="משתמשים" subtitle="חשבונות המערכת: עריכת פרופיל, תפקיד ושיוך לחברה." />
        }
        list={
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex gap-2">
              <Link to="/backoffice/users/import" className="flex-1">
                <Button type="button" variant="secondary" className="w-full">
                  ייבוא משתמשים
                </Button>
              </Link>
              <Link to="/backoffice/users/reset" className="flex-1">
                <Button type="button" variant="secondary" className="w-full">
                  איפוס סיסמה
                </Button>
              </Link>
            </div>
            <RecordList
              icon="user"
              items={listItems}
              selectedId={selectedId}
              onSelect={handleSelect}
              loading={usersQuery.isLoading}
              searchPlaceholder="חיפוש משתמש"
              emptyLabel="אין משתמשים עדיין."
            />
          </div>
        }
        detail={
          !selectedId || !form ? (
            <EmptyState
              icon="user"
              title="לא נבחר משתמש"
              hint="בחר חשבון מהרשימה כדי לערוך את שם התצוגה, התפקיד, השיוך לחברה והמוצרים החסומים שלו."
            />
          ) : (
            <div className="flex flex-col gap-6">
              {/* The record's own identity above the form, so the pane says
                  whose account is open without the user having to read it
                  back out of the first input. */}
              <div className="flex items-center gap-3.5 border-b border-border pb-5">
                <span
                  aria-hidden
                  className="font-display flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl text-accent ring-1 ring-inset ring-accent/25"
                >
                  {form.displayName.trim().charAt(0)}
                </span>
                <div className="min-w-0">
                  <h2 className="font-display truncate text-xl text-ink">
                    {form.displayName || "—"}
                  </h2>
                  <p className="mt-0.5 truncate text-sm text-ink-muted">
                    {selected?.companies?.name ?? "—"}
                  </p>
                </div>
                <span className="ms-auto shrink-0">
                  <StatusPill tone="neutral">{ROLE_LABEL[form.role]}</StatusPill>
                </span>
              </div>

              <FormSection title="פרטי חשבון" columns={2}>
                <FormField label="שם תצוגה" htmlFor="user-display-name">
                  <input
                    id="user-display-name"
                    required
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.displayName}
                    onChange={(event) =>
                      setForm(
                        (current) => current && { ...current, displayName: event.target.value },
                      )
                    }
                  />
                </FormField>

                <FormField label="תפקיד" htmlFor="user-role">
                  <select
                    id="user-role"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.role}
                    onChange={(event) =>
                      setForm(
                        (current) =>
                          current && { ...current, role: event.target.value as UserRole },
                      )
                    }
                  >
                    {(Object.keys(ROLE_LABEL) as UserRole[]).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="חברה" htmlFor="user-company">
                  <select
                    id="user-company"
                    disabled={!editing}
                    className={`${inputClassName} w-full`}
                    value={form.companyId}
                    onChange={(event) =>
                      setForm((current) => current && { ...current, companyId: event.target.value })
                    }
                  >
                    {companiesQuery.data?.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              </FormSection>

              <FormSection
                title="מוצרים חסומים"
                hint="מוצרים שסומנו כאן לא יופיעו כלל בחנות של המשתמש הזה."
              >
                <CheckboxList
                  options={catalogOptions}
                  selectedIds={form.blockedProductVarietyIds}
                  onToggle={toggleBlocked}
                  disabled={!editing}
                />
              </FormSection>

              <ActionBar
                editing={editing}
                saving={saving}
                onEdit={() => setEditing(true)}
                onDiscard={handleDiscard}
                onSave={handleSave}
                onDelete={() => setDeleteOpen(true)}
              />
            </div>
          )
        }
      />
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="מחיקת משתמש">
        <p className="mb-4 text-sm">
          האם למחוק את המשתמש &quot;{selected?.display_name}&quot;? פעולה זו אינה הפיכה — חשבון
          ההתחברות יימחק לחלוטין.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
            ביטול
          </Button>
          <Button
            variant="danger"
            onClick={() => selectedId && deleteMutation.mutate({ targetUserId: selectedId })}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "מוחק…" : "מחק"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
