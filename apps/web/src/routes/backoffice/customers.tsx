import {
  saveCustomerInputSchema,
  setCustomerScoreInputSchema,
  toSaveCustomerRpcArgs,
  toSetCustomerScoreRpcArgs,
} from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ContactPersonEditCell, ContactPersonSummary } from "@/components/reference-data/contact-person-cell";
import { formatCustomerScore } from "@/components/reference-data/customer-score";
import { CustomerScoreCell } from "@/components/reference-data/customer-score-cell";
import { checkboxClassName, inputClassName } from "@/components/reference-data/form-field";
import { RecordTable, type RecordTableColumn } from "@/components/reference-data/record-table";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/error-message";
import { hasChanges } from "@/lib/has-changes";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";
import { useContactPersonDirectory } from "@/lib/use-contact-person-directory";

interface CustomerCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  can_see_product_prices: boolean | null;
  whatsapp_group_id: string | null;
  contact_person_id: string | null;
  created_at: string;
}

/** One customer's ranking score as the table returns it — see scoresQuery. */
interface CustomerScoreRow {
  customer_company_id: string;
  general_score: string | number;
}

/** One score to save: a number on the scale, or null to clear it. */
interface ScoreChange {
  customerCompanyId: string;
  generalScore: number | null;
}

interface FormState {
  name: string;
  status: "active" | "inactive";
  canSeeProductPrices: boolean;
  whatsappGroupId: string;
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
  canSeeProductPrices: false,
  whatsappGroupId: "",
  contactPersonId: "",
};

// Field values here are never actually read: every column either has a
// `renderEdit` for the draft row or (נוצר, דירוג) checks for the draft row's
// id itself. Only `id` matters — for that, for keying, and for RecordTable's
// search-bypass.
function blankRow(): CustomerCompany {
  return {
    id: NEW_ROW_ID,
    name: "",
    status: "active",
    can_see_product_prices: false,
    whatsapp_group_id: null,
    contact_person_id: null,
    created_at: "",
  };
}

function toFormState(row: CustomerCompany): FormState {
  return {
    name: row.name,
    status: row.status,
    canSeeProductPrices: row.can_see_product_prices ?? false,
    whatsappGroupId: row.whatsapp_group_id ?? "",
    contactPersonId: row.contact_person_id ?? "",
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
        .select(
          "id, name, status, can_see_product_prices, whatsapp_group_id, contact_person_id, created_at",
        )
        .eq("type", "customer")
        .order("name");
      if (error) throw error;
      return data as CustomerCompany[];
    },
  });

  const contactDirectory = useContactPersonDirectory();

  // The ranking scores, read apart from the customers themselves because
  // they live apart: customer_scores is a backoffice-only table precisely so
  // that a score is never a column of the company row its own customer can
  // read (migration 0067). Its own query, and its own save below — the score
  // is not part of this screen's row edit.
  const scoresQueryKey = ["reference-data", "customer-scores"] as const;

  const scoresQuery = useQuery({
    queryKey: scoresQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_scores")
        .select("customer_company_id, general_score");
      if (error) throw error;
      return data as CustomerScoreRow[];
    },
  });

  const scoreByCustomer = useMemo(
    () =>
      new Map(
        (scoresQuery.data ?? []).map((row) => [row.customer_company_id, Number(row.general_score)]),
      ),
    [scoresQuery.data],
  );

  const scoreOptimistic = optimisticUpdate<CustomerScoreRow[], ScoreChange>(
    queryClient,
    scoresQueryKey,
    (rows, change) => {
      const others = (rows ?? []).filter(
        (row) => row.customer_company_id !== change.customerCompanyId,
      );
      // No score is no row, here exactly as in the table.
      return change.generalScore === null
        ? others
        : [
            ...others,
            { customer_company_id: change.customerCompanyId, general_score: change.generalScore },
          ];
    },
  );

  const scoreMutationKey = ["reference-data", "customer-scores", "set"] as const;

  const scoreMutation = useMutation({
    mutationKey: scoreMutationKey,
    // One at a time, in the order they were typed. Without it two saves of
    // the same box — a 4 corrected to a 3 a moment later — are two requests
    // racing, and whichever lands last is what the customer is ranked.
    scope: { id: "customer-score" },
    mutationFn: async (change: ScoreChange) => {
      // Parsed in here rather than before mutate(), so that a value the
      // schema refuses fails like any other refused save: rolled back, and
      // said so in a toast.
      const input = setCustomerScoreInputSchema.parse(change);
      const { error } = await supabase.rpc("set_customer_score", toSetCustomerScoreRpcArgs(input));
      if (error) throw error;
    },
    onMutate: scoreOptimistic.onMutate,
    onError: mergeOnError(scoreOptimistic.onError, (error: { message?: string }) => {
      showToast(`שמירת הדירוג נכשלה: ${errorMessage(error)}`, "error");
    }),
    // Re-read once the LAST save in the queue has settled, not after each.
    // A distributor typing down the column has several saves waiting, each
    // already shown in its box; a re-read between them comes back without
    // the ones still queued and would blank those boxes until their own
    // save landed. (This mutation still counts as in flight while its own
    // callbacks run, hence 1 and not 0.)
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: scoreMutationKey }) === 1) {
        void queryClient.invalidateQueries({ queryKey: scoresQueryKey });
      }
    },
  });

  /**
   * One score, committed from its cell.
   *
   * Silent on success, for the reason the arrangement matrix gives for its
   * own cells: a distributor ranking their customers types down the whole
   * column, and a toast per number would bury the screen — the number
   * staying in its box is the confirmation. A failure still toasts.
   *
   * Resolves to whether the write landed, never rejects: the cell puts the
   * saved score back on false.
   */
  const saveScore = async (customerCompanyId: string, score: number | null): Promise<boolean> => {
    try {
      await scoreMutation.mutateAsync({ customerCompanyId, generalScore: score });
      return true;
    } catch {
      return false;
    }
  };

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
              contact_person_id: form.contactPersonId || null,
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
        contactPersonId: form.contactPersonId || null,
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
      showToast(`השמירה נכשלה: ${errorMessage(error)}`, "error");
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
      showToast(`המחיקה נכשלה: ${errorMessage(error)}`, "error");
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
      key: "score",
      label: "דירוג",
      // No renderEdit, deliberately: the score is not one of the fields the
      // row's edit holds and saves. Its cell saves itself — see
      // CustomerScoreCell — so it is the same control whether or not the row
      // is being edited, and there is nothing to type until the customer
      // exists.
      render: (row) => {
        if (row.id === NEW_ROW_ID) return "—";
        // No scores to show — still on their way, or the read failed (see
        // the notice above the table). Never a box in either case: an empty
        // box reads as "unranked", and would take a number typed over a
        // score that is actually there.
        if (!scoresQuery.data) {
          return (
            <span className="text-xs text-ink-subtle">{scoresQuery.isError ? "לא נטען" : "…"}</span>
          );
        }
        const score = scoreByCustomer.get(row.id) ?? null;
        // The row being edited shows its score as plain text. A box here
        // would sit among the row's own fields looking like one of them while
        // obeying neither their Save nor their Cancel.
        if (row.id === editingId) {
          return (
            <span className={score === null ? "text-ink-subtle" : "font-medium text-ink"}>
              {score === null ? "חסר דירוג" : formatCustomerScore(score)}
            </span>
          );
        }
        return (
          <CustomerScoreCell
            customerName={row.name}
            score={score}
            onSave={(next) => saveScore(row.id, next)}
          />
        );
      },
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
      <PageHeader
        title="לקוחות"
        subtitle="חברות לקוחות והגדרת הצגת מחירים לכל אחת. הדירוג (1 עד 5) נשמר לשימוש בהצעת הסידור, והלקוחות אינם רואים אותו."
      />
      {/* The scores are a second read, and the customers are perfectly usable
          without them — so a failure is said here, with a way to retry,
          rather than by failing the screen. */}
      {scoresQuery.isError && !scoresQuery.data && (
        <div
          role="alert"
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-danger-soft px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/20"
        >
          <span>טעינת הדירוג נכשלה. שאר נתוני הלקוחות מוצגים כרגיל.</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void scoresQuery.refetch()}
            disabled={scoresQuery.isFetching}
          >
            {scoresQuery.isFetching ? "טוען…" : "נסה שוב"}
          </Button>
        </div>
      )}
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
        // Waits for the contact-person directory too: it's a column now,
        // and a table that paints rows before it arrives would show every
        // customer as having no contact for a moment. NOT for the scores:
        // their column says for itself when it has nothing to show, and a
        // scores read that has failed goes back to "loading" on every retry
        // — which, wired in here, would swap the whole table for its
        // skeleton, and take the focus with it, each time.
        loading={customersQuery.isLoading || contactDirectory.isLoading}
        loadError={
          (customersQuery.isError && !customersQuery.data) ||
          (contactDirectory.isError && contactDirectory.options.length === 0)
            ? {
                what: "רשימת הלקוחות",
                onRetry: () => {
                  void customersQuery.refetch();
                  contactDirectory.refetch();
                },
                retrying: customersQuery.isFetching || contactDirectory.isFetching,
              }
            : null
        }
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
