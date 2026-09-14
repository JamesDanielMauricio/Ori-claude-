import { saveUserInputSchema, toSaveUserRpcArgs } from "@ori/domain/reference-data";
import type { UserRole } from "@ori/shared/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { CellChipList } from "@/components/reference-data/cell-popover";
import { inputClassName } from "@/components/reference-data/form-field";
import { ProductMultiSelectCell } from "@/components/reference-data/product-multi-select-cell";
import { RecordTable, type RecordTableColumn } from "@/components/reference-data/record-table";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { hasChanges } from "@/lib/has-changes";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";
import { trpc } from "@/lib/trpc-client";

interface ProfileRow {
  user_id: string;
  display_name: string;
  role: UserRole;
  company_id: string;
  // Optional editable field (reference/prd/edit-profile.md) and the source
  // of the individual-WhatsApp-dispatch batch when a company has no
  // whatsapp_group_id set — see profile.ts's schema comment. Not part of
  // `save_user`'s RPC signature (packages/db/migrations/0007), so saving it
  // is a plain `.update()` against `profiles` — already permitted by the
  // "profiles_update_backoffice" RLS policy (packages/db/migrations/0006),
  // no new function or migration required.
  phone_number: string | null;
  // True while the account is still on an admin-issued temporary password
  // (the PRD's "Temp Pass" state) — cleared by the client the moment the
  // user sets their own. Read-only here: it's set by the import/reset
  // flows, not something to toggle by hand.
  must_change_password: boolean;
  created_at: string;
  companies: { name: string } | null;
}

// One place for the role wording, so the table's badge and the <select>
// below can never drift apart.
const ROLE_LABEL: Record<UserRole, string> = {
  backoffice: "משרד אחורי",
  grower: "מגדל",
  customer: "לקוח",
};

const CREATED_AT_FORMAT = new Intl.DateTimeFormat("he-IL", { dateStyle: "short" });

interface FormState {
  displayName: string;
  role: UserRole;
  companyId: string;
  phoneNumber: string;
  blockedProductVarietyIds: Set<string>;
}

function toFormState(row: ProfileRow, blocked: string[]): FormState {
  return {
    displayName: row.display_name,
    role: row.role,
    companyId: row.company_id,
    phoneNumber: row.phone_number ?? "",
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

  // Which row (by user_id) is being edited inline right now — this screen
  // has no "new record" draft (see the header comment), so this is always
  // either an existing user's id or null.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const usersQueryKey = ["reference-data", "users"] as const;
  const blockedQueryKey = ["reference-data", "blocked-products-all"] as const;

  const usersQuery = useQuery({
    queryKey: usersQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "user_id, display_name, role, company_id, phone_number, must_change_password, created_at, companies(name)",
        )
        .order("display_name");
      if (error) throw error;
      return data as unknown as ProfileRow[];
    },
  });

  // Login emails live in `auth.users`, which PostgREST doesn't expose — so
  // they come from the API's service-role endpoint and get joined onto the
  // profiles rows by id here. See apps/api/src/routers/auth.ts.
  const emailsQuery = trpc.auth.listUserEmails.useQuery();

  // Every user's blocked-product selection in ONE read, grouped
  // client-side — same reasoning as growers.tsx's identical bulk read: the
  // blacklist is a column now, so every visible row needs its own value.
  const blockedQuery = useQuery({
    queryKey: blockedQueryKey,
    queryFn: async () => {
      const rows = await fetchAllRows<{ user_id: string; product_variety_id: string }>((from, to) =>
        supabase
          .from("profile_blocked_products")
          .select("user_id, product_variety_id")
          .range(from, to),
      );
      const byUser = new Map<string, string[]>();
      for (const row of rows) {
        const list = byUser.get(row.user_id);
        if (list) list.push(row.product_variety_id);
        else byUser.set(row.user_id, [row.product_variety_id]);
      }
      return byUser;
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
  const varietyLabelById = useMemo(
    () => new Map(catalogOptions.map((option) => [option.id, option.label])),
    [catalogOptions],
  );

  const selected = usersQuery.data?.find((row) => row.user_id === editingId) ?? null;
  const deleteTarget = usersQuery.data?.find((row) => row.user_id === deleteTargetId) ?? null;

  const saveOptimistic = optimisticUpdate<ProfileRow[], void>(
    queryClient,
    usersQueryKey,
    (rows) =>
      rows?.map((row) =>
        row.user_id === editingId && form
          ? {
              ...row,
              display_name: form.displayName,
              role: form.role,
              company_id: form.companyId,
              phone_number: form.phoneNumber || null,
            }
          : row,
      ),
  );

  // The blacklist is its own query, so it needs its own optimistic patch —
  // see growers.tsx's identical pairing.
  const saveBlockedOptimistic = optimisticUpdate<Map<string, string[]>, void>(
    queryClient,
    blockedQueryKey,
    (byUser) => {
      if (!byUser || !editingId || !form) return byUser;
      const next = new Map(byUser);
      next.set(editingId, [...form.blockedProductVarietyIds]);
      return next;
    },
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editingId || !form) throw new Error("No user selected");
      const input = saveUserInputSchema.parse({
        userId: editingId,
        displayName: form.displayName,
        role: form.role,
        companyId: form.companyId,
        blockedProductVarietyIds: [...form.blockedProductVarietyIds],
      });
      const { data, error } = await supabase.rpc("save_user", toSaveUserRpcArgs(input));
      if (error) throw error;
      // Phone number isn't part of save_user's RPC signature — a plain
      // update, covered by the same "profiles_update_backoffice" RLS policy
      // that lets this screen edit another user's role/company at all.
      const { error: phoneError } = await supabase
        .from("profiles")
        .update({ phone_number: form.phoneNumber || null })
        .eq("user_id", editingId);
      if (phoneError) throw phoneError;
      return data as { user_id: string };
    },
    onMutate: async (variables) => {
      const rows = await saveOptimistic.onMutate(variables);
      const blocked = await saveBlockedOptimistic.onMutate(variables);
      return { rows, blocked };
    },
    onSuccess: () => {
      showToast("הנתונים נשמרו.", "success");
      setEditingId(null);
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: usersQueryKey });
      void queryClient.invalidateQueries({ queryKey: blockedQueryKey });
    },
    onError: (
      error: { message?: string },
      variables,
      context:
        | {
            rows: { previous: ProfileRow[] | undefined } | undefined;
            blocked: { previous: Map<string, string[]> | undefined } | undefined;
          }
        | undefined,
    ) => {
      saveOptimistic.onError(error, variables, context?.rows);
      saveBlockedOptimistic.onError(error, variables, context?.blocked);
      showToast(`השמירה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const deleteOptimistic = optimisticUpdate<ProfileRow[], { targetUserId: string }>(
    queryClient,
    usersQueryKey,
    (rows, variables) => rows?.filter((row) => row.user_id !== variables.targetUserId),
  );

  const deleteMutation = trpc.auth.deleteUser.useMutation({
    onMutate: deleteOptimistic.onMutate,
    onSuccess: () => {
      showToast("המשתמש נמחק.", "success");
      setDeleteTargetId(null);
      void queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
    onError: mergeOnError(deleteOptimistic.onError, (error: { message?: string }) => {
      showToast(`המחיקה נכשלה: ${error.message}`, "error");
      setDeleteTargetId(null);
    }),
  });

  // Seeded synchronously from data the table already has — the blacklist is
  // loaded up front for its column, not lazily on click.
  function handleEditRow(row: ProfileRow) {
    setEditingId(row.user_id);
    setForm(toFormState(row, blockedQuery.data?.get(row.user_id) ?? []));
  }

  function handleCancel() {
    setEditingId(null);
    setForm(null);
  }

  const baselineForm = selected
    ? toFormState(selected, blockedQuery.data?.get(selected.user_id) ?? [])
    : null;
  const dirty = baselineForm === null || hasChanges(form, baselineForm);

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

  const columns: RecordTableColumn<ProfileRow>[] = [
    {
      key: "name",
      label: "שם תצוגה",
      render: (row) => <span className="font-medium text-ink">{row.display_name}</span>,
      renderEdit: () => {
        if (!form) return null;
        return (
          <input
            aria-label="שם תצוגה"
            autoFocus
            required
            className={`${inputClassName} w-full min-w-[9rem]`}
            value={form.displayName}
            onChange={(event) =>
              setForm((current) => current && { ...current, displayName: event.target.value })
            }
          />
        );
      },
    },
    {
      key: "email",
      label: "אימייל",
      // Read-only: the login identity is an Auth record, not a profile
      // field — changing it is a credential operation, not an edit here.
      render: (row) => emailsQuery.data?.[row.user_id] ?? "—",
    },
    {
      key: "role",
      label: "תפקיד",
      render: (row) => <StatusPill tone="neutral">{ROLE_LABEL[row.role]}</StatusPill>,
      renderEdit: () => {
        if (!form) return null;
        return (
          <Select
            aria-label="תפקיד"
            className="w-32"
            value={form.role}
            onChange={(next) => setForm((current) => current && { ...current, role: next as UserRole })}
            options={(Object.keys(ROLE_LABEL) as UserRole[]).map((role) => ({
              value: role,
              label: ROLE_LABEL[role],
            }))}
          />
        );
      },
    },
    {
      key: "company",
      label: "חברה",
      render: (row) => row.companies?.name ?? "—",
      renderEdit: () => {
        if (!form) return null;
        return (
          <Select
            aria-label="חברה"
            className="w-full min-w-[9rem]"
            value={form.companyId}
            onChange={(next) =>
              setForm((current) => current && { ...current, companyId: next })
            }
            options={
              companiesQuery.data?.map((company) => ({ value: company.id, label: company.name })) ?? []
            }
          />
        );
      },
    },
    {
      key: "phone",
      label: "טלפון",
      render: (row) => row.phone_number || "—",
      renderEdit: () => {
        if (!form) return null;
        return (
          <input
            type="tel"
            aria-label="טלפון"
            className={`${inputClassName} w-32`}
            value={form.phoneNumber}
            onChange={(event) =>
              setForm((current) => current && { ...current, phoneNumber: event.target.value })
            }
          />
        );
      },
    },
    {
      key: "blocked",
      label: "מוצרים חסומים",
      render: (row) => (
        <CellChipList
          items={(blockedQuery.data?.get(row.user_id) ?? []).map(
            (id) => varietyLabelById.get(id) ?? id,
          )}
          emptyLabel="אין מוצרים חסומים"
          tone="danger"
        />
      ),
      renderEdit: () => {
        if (!form) return null;
        return (
          <ProductMultiSelectCell
            label="מוצרים חסומים"
            options={catalogOptions}
            selectedIds={form.blockedProductVarietyIds}
            onToggle={toggleBlocked}
          />
        );
      },
    },
    {
      key: "tempPassword",
      label: "סיסמה זמנית",
      // Read-only: set by the import / admin-reset flows, cleared by the
      // user's own password change.
      render: (row) =>
        row.must_change_password ? (
          <StatusPill tone="warning" dot>
            ממתין לשינוי
          </StatusPill>
        ) : (
          <span className="text-sm text-ink-subtle">—</span>
        ),
    },
    {
      key: "created",
      label: "נוצר",
      render: (row) =>
        row.created_at ? CREATED_AT_FORMAT.format(new Date(row.created_at)) : "—",
    },
  ];

  return (
    <>
      <PageHeader title="משתמשים" subtitle="חשבונות המערכת: עריכת פרופיל, תפקיד ושיוך לחברה." />
      <RecordTable
        columns={columns}
        rows={usersQuery.data ?? []}
        getRowId={(row) => row.user_id}
        searchText={(row) =>
          `${row.display_name} ${row.companies?.name ?? ""} ${emailsQuery.data?.[row.user_id] ?? ""}`
        }
        editingId={editingId}
        savingEdit={saving}
        dirtyEdit={dirty}
        onEdit={handleEditRow}
        onSaveEdit={handleSave}
        onCancelEdit={handleCancel}
        onDelete={(row) => setDeleteTargetId(row.user_id)}
        toolbarExtra={
          <>
            <Link to="/backoffice/users/import">
              <Button type="button" variant="secondary">
                ייבוא משתמשים
              </Button>
            </Link>
            <Link to="/backoffice/users/reset">
              <Button type="button" variant="secondary">
                איפוס סיסמה
              </Button>
            </Link>
          </>
        }
        loading={usersQuery.isLoading || blockedQuery.isLoading}
        searchPlaceholder="חיפוש משתמש"
        emptyLabel="אין משתמשים עדיין."
      />

      <Dialog open={deleteTargetId !== null} onClose={() => setDeleteTargetId(null)} title="מחיקת משתמש">
        <p className="mb-4 text-sm">
          האם למחוק את המשתמש &quot;{deleteTarget?.display_name}&quot;? פעולה זו אינה הפיכה — חשבון
          ההתחברות יימחק לחלוטין.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTargetId(null)}>
            ביטול
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteTargetId && deleteMutation.mutate({ targetUserId: deleteTargetId })}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "מוחק…" : "מחק"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
