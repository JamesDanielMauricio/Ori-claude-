import { useState, type FormEvent } from "react";

import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { trpc } from "@/lib/trpc-client";

export default function AdminResetPasswordPage() {
  const [targetUserId, setTargetUserId] = useState("");
  const resetPassword = trpc.auth.adminResetPassword.useMutation();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    resetPassword.mutate({ targetUserId });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="איפוס סיסמה למשתמש"
        subtitle="מפיק קישור חד-פעמי ושולח אותו ישירות למשתמש — הקישור לעולם לא מוצג כאן. המשתמש מנותק מכל התחברות קיימת ויידרש לקבוע סיסמה חדשה בכניסה הבאה."
      />

      <form
        onSubmit={handleSubmit}
        className="flex max-w-md flex-col gap-4 rounded-lg border border-border bg-surface shadow-card p-5"
      >
        <FormField label="מזהה משתמש" htmlFor="targetUserId">
          <input
            id="targetUserId"
            required
            placeholder="UUID של המשתמש"
            dir="ltr"
            className={`${inputClassName} w-full text-left font-mono text-xs`}
            value={targetUserId}
            onChange={(event) => setTargetUserId(event.target.value)}
          />
          {/* Known UX gap, documented in UAT_CHECKLIST.md § 5: a raw UUID,
              not a name/email picker — stated inline rather than hidden. */}
          <p className="mt-1 text-xs text-ink-muted">
            את המזהה ניתן להעתיק מרשימת המשתמשים במסך &quot;משתמשים&quot;.
          </p>
        </FormField>

        <Button type="submit" disabled={resetPassword.isPending}>
          {resetPassword.isPending ? "שולח…" : "שלח קישור לאיפוס"}
        </Button>

        {resetPassword.isSuccess && (
          <p className="rounded-md bg-accent-soft px-3 py-2 text-sm">הקישור הופק ונשלח למשתמש.</p>
        )}
        {resetPassword.isError && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {resetPassword.error.message}
          </p>
        )}
      </form>
    </div>
  );
}
