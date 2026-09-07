import { useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
            {bulkCreate.isPending ? "יוצר…" : "צור משתמשים"}
          </Button>
        </div>
      </form>

      {bulkCreate.data && (
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
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                      נוצר
                    </span>
                  ) : (
                    <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                      דולג ({result.reason})
                    </span>
                  )}
                </TableCell>
                <TableCell dir="ltr" className="max-w-xs truncate text-left font-mono text-xs">
                  {result.status === "created" ? result.recoveryLink : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableContainer>
      )}
    </div>
  );
}
