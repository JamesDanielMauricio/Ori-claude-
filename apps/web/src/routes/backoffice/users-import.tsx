import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Select, type SelectOption } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { trpc } from "@/lib/trpc-client";

interface CompanyOption {
  id: string;
  name: string;
  type: string;
  status: "active" | "inactive";
}

interface DraftRow {
  email: string;
  displayName: string;
  role: "backoffice" | "grower" | "customer";
  companyId: string;
}

function emptyRow(): DraftRow {
  return { email: "", displayName: "", role: "grower", companyId: "" };
}

// Roles a signed-in account can hold. Transporter is deliberately absent —
// it never signs in, so there is no account to create (see the schema's
// user_role enum comment).
const ROLE_LABEL: Record<DraftRow["role"], string> = {
  backoffice: "מנהל / משווק",
  grower: "מגדל",
  customer: "לקוח",
};

export default function BulkImportUsersPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [missingCompany, setMissingCompany] = useState(false);
  const bulkCreate = trpc.auth.bulkCreateUsers.useMutation();

  // Picked by name rather than typed in as a UUID, which no screen shows.
  // Readable by backoffice through the companies RLS policies.
  const companiesQuery = useQuery({
    queryKey: ["users-import", "companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, type, status")
        .order("name");
      if (error) throw error;
      return data as CompanyOption[];
    },
  });

  // A user's company is always of the type matching their role (every
  // existing account is), so each row only offers those.
  const companyOptionsByRole = useMemo(() => {
    const byRole = new Map<string, SelectOption[]>();
    for (const role of Object.keys(ROLE_LABEL)) {
      byRole.set(role, [
        { value: "", label: "בחר חברה", disabled: true },
        ...(companiesQuery.data ?? [])
          .filter((company) => company.type === role)
          .map((company) => ({
            value: company.id,
            label: company.status === "active" ? company.name : `${company.name} (לא פעילה)`,
          })),
      ]);
    }
    return byRole;
  }, [companiesQuery.data]);

  function updateRow(index: number, patch: Partial<DraftRow>) {
    setMissingCompany(false);
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        // Changing the role empties a company that no longer fits it,
        // rather than leaving a grower company on a customer.
        const company = companiesQuery.data?.find((option) => option.id === next.companyId);
        if (company && company.type !== next.role) next.companyId = "";
        return next;
      }),
    );
  }

  if (companiesQuery.isLoading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  if (companiesQuery.isError) {
    return (
      <QueryError
        what="רשימת החברות"
        onRetry={() => void companiesQuery.refetch()}
        retrying={companiesQuery.isFetching}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ייבוא משתמשים"
        subtitle="כל שורה יוצרת חשבון ופרופיל. אין סיסמה למסור — לכל משתמש שנוצר מופק קישור חד-פעמי (מוגבל בזמן, לשימוש יחיד) לשליחה ישירה אליו. מוביל אינו תפקיד כאן: הוא לעולם לא מתחבר למערכת."
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          // The email and name boxes are checked by the browser (`required`);
          // the company is a custom dropdown, so it's checked here.
          if (rows.some((row) => !row.companyId)) {
            setMissingCompany(true);
            return;
          }
          bulkCreate.mutate({
            rows: rows.map((row) => ({
              email: row.email,
              displayName: row.displayName,
              role: row.role,
              companyId: row.companyId,
            })),
          });
        }}
        className="flex flex-col gap-4"
      >
        <TableContainer className="bg-surface">
          <TableHeader>
            <TableRow>
              <TableHead>אימייל</TableHead>
              <TableHead>שם תצוגה</TableHead>
              <TableHead>תפקיד</TableHead>
              <TableHead>חברה</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={index}>
                <TableCell>
                  <input
                    type="email"
                    required
                    aria-label="אימייל"
                    className={`${inputClassName} w-full min-w-48`}
                    value={row.email}
                    onChange={(event) => updateRow(index, { email: event.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <input
                    required
                    aria-label="שם תצוגה"
                    className={`${inputClassName} w-full min-w-36`}
                    value={row.displayName}
                    onChange={(event) => updateRow(index, { displayName: event.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    aria-label="תפקיד"
                    value={row.role}
                    onChange={(next) => updateRow(index, { role: next as DraftRow["role"] })}
                    options={(Object.keys(ROLE_LABEL) as Array<DraftRow["role"]>).map((role) => ({
                      value: role,
                      label: ROLE_LABEL[role],
                    }))}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    aria-label="חברה"
                    className="w-full min-w-56"
                    value={row.companyId}
                    onChange={(next) => updateRow(index, { companyId: next })}
                    options={companyOptionsByRole.get(row.role) ?? []}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableContainer>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRows((current) => [...current, emptyRow()])}
          >
            הוסף שורה
          </Button>
          <Button type="submit" disabled={bulkCreate.isPending}>
            {bulkCreate.isPending && (
              <span
                aria-hidden
                className="animate-spin-loop h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {bulkCreate.isPending ? "יוצר…" : "צור משתמשים"}
          </Button>
        </div>
        {missingCompany && (
          <p role="alert" className="text-sm text-danger">
            יש לבחור חברה בכל שורה.
          </p>
        )}
      </form>

      {/* A failed import used to report nothing at all: the spinner stopped,
          no results table appeared, and the admin had no way to tell a server
          error from a batch that silently did nothing. The sibling
          admin-reset screen already surfaces its mutation error this way. */}
      {bulkCreate.isError && (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/20"
        >
          <Icon name="alertCircle" className="mt-px h-4 w-4 shrink-0" />
          הייבוא נכשל: {bulkCreate.error.message}
        </p>
      )}

      {bulkCreate.data && (
        // The results get their own titled section. Previously a second
        // unlabelled table appeared directly under the first, and it was not
        // obvious at a glance which one was input and which was outcome.
        <section className="animate-rise-in mt-2 flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">תוצאות הייבוא</h2>
            <p className="mt-1 text-sm text-ink-muted">
              כל קישור חד-פעמי מוצג כאן פעם אחת בלבד — העתק אותו ושלח למשתמש לפני שתעזוב את הדף.
            </p>
          </div>
          <TableContainer className="bg-surface">
            <TableHeader>
              <TableRow>
                <TableHead>אימייל</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead>קישור חד-פעמי</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bulkCreate.data.map((result) => (
                <TableRow key={result.email}>
                  <TableCell dir="ltr" className="text-left">
                    {result.email}
                  </TableCell>
                  <TableCell>
                    {result.status === "created" ? (
                      <StatusPill tone="accent" dot>
                        נוצר
                      </StatusPill>
                    ) : (
                      <StatusPill tone="warning" dot>
                        דולג ({result.reason})
                      </StatusPill>
                    )}
                  </TableCell>
                  <TableCell dir="ltr" className="max-w-xs truncate text-left font-mono text-xs">
                    {result.status === "created" ? result.recoveryLink : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableContainer>
        </section>
      )}
    </div>
  );
}
