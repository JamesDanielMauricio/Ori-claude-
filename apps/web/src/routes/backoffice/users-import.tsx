import { useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import {
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc-client";

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
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const bulkCreate = trpc.auth.bulkCreateUsers.useMutation();

  function updateRow(index: number, patch: Partial<DraftRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
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
              <TableHead>מזהה חברה</TableHead>
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
                  <select
                    aria-label="תפקיד"
                    className={inputClassName}
                    value={row.role}
                    onChange={(event) =>
                      updateRow(index, { role: event.target.value as DraftRow["role"] })
                    }
                  >
                    {(Object.keys(ROLE_LABEL) as Array<DraftRow["role"]>).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <input
                    required
                    aria-label="מזהה חברה"
                    placeholder="UUID של החברה"
                    dir="ltr"
                    className={`${inputClassName} w-full min-w-72 text-left font-mono text-xs`}
                    value={row.companyId}
                    onChange={(event) => updateRow(index, { companyId: event.target.value })}
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
            <h2 className="font-display text-xl text-ink">תוצאות הייבוא</h2>
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
